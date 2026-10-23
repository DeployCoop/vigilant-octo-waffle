/**
 * Waffle secrets provisioning: Supabase JWT derivation, pipeline/step
 * secret sync, and project .env loading (Plan III §7.3 split of
 * waffle/runner.ts). Behavior-preserving file motion only — WaffleRunner
 * delegates to these functions with its projectRoot and log sink.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import { execFileAsync } from '../exec-argv.js';
import { getWaffleExecutionEnv, errMessage, type WaffleLogFn } from './shared.js';
import { type WaffleSecretKey } from './schema.js';

/**
 * Derives Supabase ANON_KEY / SERVICE_ROLE_KEY as HS256 JWTs signed with SUPABASE_JWT_SECRET.
 * Returns undefined for any other variable or when the signing secret is not set.
 */
export function deriveSupabaseJwt(envVar: string, loadEnvFiles: () => Record<string, string>): string | undefined {
  const role = envVar === 'SUPABASE_ANON_KEY' ? 'anon' : envVar === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service_role' : undefined;
  const secret = process.env.SUPABASE_JWT_SECRET || loadEnvFiles()['SUPABASE_JWT_SECRET'];
  if (!role || !secret) return undefined;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase', iat: now, exp: now + 10 * 365 * 24 * 3600 })}`;
  const sig = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

/**
 * Provision Kubernetes Secrets defined in pipeline.keys or step.keys
 */
export async function provisionSecrets(
  secrets: WaffleSecretKey[],
  defaultNamespace: string,
  log: WaffleLogFn,
  projectRoot: string,
  dryRun?: boolean
): Promise<void> {
  for (const sec of secrets) {
    const ns = sec.namespace || defaultNamespace;
    log(`[KEYS] Ensuring Kubernetes Secret "${sec.name}" in namespace "${ns}"...`);
    if (dryRun) {
      log(`[KEYS] [DRY-RUN] Secret "${sec.name}" creation simulated.`);
      continue;
    }

    const secretData: Record<string, string> = {};
    if (sec.literals) {
      const missing = new Set<string>();
      const malformed = new Set<string>();
      for (const [k, v] of Object.entries(sec.literals)) {
        // Interpolate every ${VAR} occurrence (whole-value or embedded in a URL).
        // Never fall back to a built-in default: published placeholder secrets
        // (e.g. *_change_me) must not reach a cluster.
        secretData[k] = String(v).replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_m, envVar: string) => {
          const fromEnv = process.env[envVar] ?? loadProjectEnvFiles(projectRoot)[envVar];
          if (fromEnv !== undefined && fromEnv !== '') {
            if (envVar === 'SUPABASE_ANON_KEY' || envVar === 'SUPABASE_SERVICE_ROLE_KEY') {
              if (fromEnv.split('.').length === 3) return fromEnv;
              // Set but not JWT-shaped (e.g. a modern sb_publishable_ key):
              // remember the distinction so the error below does not
              // claim a set variable is "unset".
              malformed.add(envVar);
            } else {
              return fromEnv;
            }
          }
          const derived = deriveSupabaseJwt(envVar, () => loadProjectEnvFiles(projectRoot));
          if (derived) return derived;
          if (!malformed.has(envVar)) missing.add(envVar);
          return '';
        });
      }
      if (missing.size > 0 || malformed.size > 0) {
        const parts: string[] = [];
        if (missing.size > 0) {
          parts.push(`unset environment variable(s): ${[...missing].sort().join(', ')}`);
        }
        if (malformed.size > 0) {
          parts.push(
            `variable(s) set but not JWT-shaped (expected 3 dot-separated parts) and no SUPABASE_JWT_SECRET available to derive a JWT from: ${[...malformed].sort().join(', ')}`
          );
        }
        throw new Error(
          `Secret "${sec.name}" requires ${parts.join('; ')}. ` +
            `Export them (see charts/production-prep.md) before running the pipeline.`
        );
      }
      for (const [k, val] of Object.entries(secretData)) {
        if (/change_?me/i.test(val)) {
          throw new Error(`Secret "${sec.name}" key "${k}" still contains a "change_me" placeholder; refusing to apply.`);
        }
      }
    }
    if (sec.fromEnv) {
      for (const envVar of sec.fromEnv) {
        const val = process.env[envVar] || loadProjectEnvFiles(projectRoot)[envVar] || '';
        secretData[envVar] = val;
      }
    }

    if (Object.keys(secretData).length > 0) {
      try {
        const nsManifest = await execFileAsync(
          'kubectl',
          ['create', 'namespace', ns, '--dry-run=client', '-o', 'yaml'],
          { env: getWaffleExecutionEnv() }
        );
        await execFileAsync('kubectl', ['apply', '-f', '-'], {
          env: getWaffleExecutionEnv(),
          input: nsManifest.stdout,
        });
        const manifestObj = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: sec.name,
            namespace: ns,
            labels: {
              'app.kubernetes.io/managed-by': 'waffle',
            },
            annotations: {
              // Keep Helm from deleting this secret if a previous release rendered one with the same name.
              'helm.sh/resource-policy': 'keep',
            },
          },
          type: 'Opaque',
          stringData: secretData,
        };
        const manifestJson = JSON.stringify(manifestObj);
        await execFileAsync('kubectl', ['apply', '-f', '-'], {
          env: getWaffleExecutionEnv(),
          input: manifestJson,
        });
        log(`[KEYS] Secret "${sec.name}" synchronized in namespace "${ns}".`);
      } catch (err) {
        log(`[KEYS] Notice: Secret sync encountered: ${errMessage(err)}`);
      }
    }
  }
}

/**
 * Reads KEY=VALUE pairs from <projectRoot>/.env.production then .env (earlier file wins).
 * The Studio (Next.js) server does not load these itself, unlike the waffle CLI, so secrets
 * such as BILLAMA_MASTER_API_KEY would otherwise look unset when a run starts from the UI.
 * Process env always takes precedence (callers check it first).
 */
export function loadProjectEnvFiles(projectRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['.env.production', '.env']) {
    const file = path.join(projectRoot, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!m || m[1] in out) continue;
      let v = m[2].trim();
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  return out;
}
