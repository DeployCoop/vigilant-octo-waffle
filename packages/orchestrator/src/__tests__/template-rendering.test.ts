/**
 * preserveUnknown sweep guards (follow-up to the WS3 parity fixes).
 *
 * substituteVariables has two modes: shell-like (expand defaults, blank
 * unknowns — correct for config resolution in config.ts) and
 * envsubst-allowlist (`preserveUnknown` — required for file-template
 * rendering, where literal `$` content belongs to downstream consumers:
 * PHP `$settings` in app manifests, Go-template locals like
 * `$releaseName` in the OpenEBS Alloy config). PR #46 converted the
 * Argo/Flux manifest paths; this suite guards the remaining call sites:
 *
 *  1. a source scan fails if any substituteVariables call outside
 *     config.ts lacks `preserveUnknown` (or if config.ts grows new
 *     unreviewed call sites);
 *  2. the exported render entry points preserve literal `$` content
 *     end-to-end;
 *  3. the real src/*.tpl templates render completely — with a full
 *     default.env-derived env, preserveUnknown output is byte-identical
 *     to the historical behavior for the first-party templates (every
 *     ref is a defaulted THIS_* var), while the OpenEBS values keep
 *     their embedded Go templates intact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substituteVariables } from '../template.js';
import { renderAppManifest } from '../app-deployer.js';
import { renderInitializerManifests } from '../initializer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const srcDir = path.join(repoRoot, 'packages', 'orchestrator', 'src');
const tplDir = path.join(repoRoot, 'src');

/** Extract every substituteVariables(...) call's full text from a source
 *  file (paren-matched, so multi-line calls are captured whole). */
function extractCalls(file: string): string[] {
  const text = fs.readFileSync(file, 'utf-8');
  const calls: string[] = [];
  const needle = 'substituteVariables(';
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    let depth = 0;
    let end = idx + needle.length - 1; // at the '('
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(text.slice(idx, end + 1));
    idx = text.indexOf(needle, end + 1);
  }
  return calls;
}

describe('preserveUnknown sweep: call-site guard', () => {
  it('every substituteVariables call outside config resolution opts in', () => {
    const offenders: string[] = [];
    let configCalls = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (entry.name.endsWith('.ts') && entry.name !== 'template.ts') {
          for (const call of extractCalls(full)) {
            if (call.includes('preserveUnknown')) continue;
            if (path.basename(full) === 'config.ts') {
              configCalls++;
              continue;
            }
            offenders.push(`${path.relative(srcDir, full)}: ${call.slice(0, 80)}…`);
          }
        }
      }
    };
    walk(srcDir);
    assert.deepEqual(offenders, [], 'call sites rendering file templates must pass { preserveUnknown: true }');
    assert.equal(configCalls, 2, 'config.ts keeps exactly its two shell-like config-resolution calls; new ones need review');
  });
});

/** A temp VOW project: real src/ symlinked in (for default.env), plus the
 *  fixture files the caller writes. Mirrors the parity harness setup. */
function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-tpl-test-'));
  fs.symlinkSync(path.join(repoRoot, 'src'), path.join(root, 'src'), 'dir');
  fs.writeFileSync(path.join(root, '.env'), 'THIS_NAME=tpltest\n');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const LITERAL_DOLLAR_YAML = [
  'apiVersion: argoproj.io/v1alpha1',
  'kind: Application',
  'metadata:',
  '  name: demo-${THIS_NAME}',
  'spec:',
  '  source:',
  '    helm:',
  '      values: |',
  "        config: $settings['db_host'] = 'localhost';",
  '        webhookSecret: "tok$Ab3xY"',
  '        home: ${HOME_DIR}/data',
  '',
].join('\n');

describe('preserveUnknown sweep: render entry points', () => {
  it('renderAppManifest expands known vars and preserves literal $ content', () => {
    const root = makeProject({ 'argo/demo/argocd.yaml': LITERAL_DOLLAR_YAML });
    const out = renderAppManifest(root, 'demo', { THIS_NAME: 'rendered' });
    assert.ok(out, 'manifest renders');
    assert.match(out, /name: demo-rendered/);
    assert.ok(out.includes("$settings['db_host']"), 'PHP $settings survives');
    assert.ok(out.includes('tok$Ab3xY'), 'literal $ inside a secret value survives');
    assert.ok(out.includes('${HOME_DIR}/data'), 'unknown braced reference passes through for downstream');
  });

  it('renderInitializerManifests preserves literal $ content', () => {
    const root = makeProject({ 'init/demo/app.yaml': LITERAL_DOLLAR_YAML });
    const results = renderInitializerManifests(root, 'init/demo', { THIS_NAME: 'rendered' });
    assert.equal(results.length, 1);
    const out = results[0].content;
    assert.match(out, /name: demo-rendered/);
    assert.ok(out.includes("$settings['db_host']"));
    assert.ok(out.includes('tok$Ab3xY'));
    assert.ok(out.includes('${HOME_DIR}/data'));
  });
});

/** Env equivalent to loadProjectConfig on a bare project: every
 *  `: "${KEY:=default}"` line of src/default.env contributes its default,
 *  with nested references between defaults resolved the way config
 *  resolution resolves them (e.g. THIS_STORAGE_PATH=/mnt/${THIS_NAME}). */
function defaultEnv(): Record<string, string> {
  const text = fs.readFileSync(path.join(tplDir, 'default.env'), 'utf-8');
  const env: Record<string, string> = {};
  for (const m of text.matchAll(/: "\$\{([A-Za-z0-9_]+):=(.*)\}"/g)) {
    env[m[1]] = m[2];
  }
  env.THIS_NAME ??= 'tpltest'; // project .env supplies it in real projects
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const [k, v] of Object.entries(env)) {
      const resolved = substituteVariables(v, env);
      if (resolved !== v) {
        env[k] = resolved;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return env;
}

const FIRST_PARTY_TEMPLATES = [
  'kind-config.tpl',
  'k3d-config.tpl',
  'k3d-mqtt-config.tpl',
  'ingress-nginx-values.tpl',
  'ingress-nginx-minimal-values.tpl',
  'ingress-nginx-mqtt-values.tpl',
  'ingress-traefik-values.tpl',
  'ingress-haproxy-values.tpl',
  'ingress-haproxy-mqtt-values.tpl',
];

describe('preserveUnknown sweep: real templates', () => {
  it('first-party templates: identical output, fully expanded', () => {
    const env = defaultEnv();
    for (const tpl of FIRST_PARTY_TEMPLATES) {
      const raw = fs.readFileSync(path.join(tplDir, tpl), 'utf-8');
      const preserved = substituteVariables(raw, env, { preserveUnknown: true });
      const historical = substituteVariables(raw, env);
      assert.equal(preserved, historical, `${tpl}: conversion must not change output for a complete env`);
      assert.ok(!preserved.includes('${'), `${tpl}: no unexpanded reference remains`);
    }
  });

  it('openebs-values.tpl: Go-template content survives, THIS_* vars expand', () => {
    const raw = fs.readFileSync(path.join(tplDir, 'openebs-values.tpl'), 'utf-8');
    const env = {
      ...defaultEnv(),
      THIS_LVM_VG: 'vg0',
      THIS_OPENEBS_NAMESPACE: 'openebs',
    };
    const out = substituteVariables(raw, env, { preserveUnknown: true });
    assert.ok(out.includes('$releaseName'), 'Alloy discovery config keeps its Go-template locals');
    assert.ok(out.includes('discovery.relabel'), 'Alloy blocks intact');
    assert.ok(!out.includes('${THIS_'), 'every THIS_* reference expanded');
    assert.match(out, /enabled: false/, 'minio toggle renders its default.env value');
    const on = substituteVariables(raw, { ...env, THIS_OPENEBS_ENABLE_MINIO: 'true' }, { preserveUnknown: true });
    assert.match(on, /enabled: true/, 'minio toggle honors the configured value');
  });
});
