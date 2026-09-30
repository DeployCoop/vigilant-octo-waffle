import * as fs from 'node:fs';
import * as path from 'node:path';
import { substituteVariables } from './template.js';

export interface VowConfig {
  raw: Record<string, string>;
  enablers: Record<string, boolean>;
  chartsDir: string;
  cluster: {
    k8sPlatform: 'kind' | 'k3d' | 'k3s';
    ingress: 'nginx' | 'traefik' | 'haproxy';
    cdRunner: 'argocd' | 'flux' | 'both';
    clusterIssuer: string;
    domain: string;
    namespace: string;
    adminUser: string;
    fluxNamespace: string;
    chartsDir: string;
    appDomains: Record<string, string>;
  };
}

/**
 * Parses default.env which has lines like : "${VAR:=DEFAULT}" or VAR=VAL
 */
export function parseDefaultEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (!line.startsWith(':')) {
      // Matches regular KEY=VALUE or KEY="VALUE"
      const standardMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (standardMatch) {
        const [, key, val] = standardMatch;
        env[key] = val.replace(/^["']|["']$/g, '').trim();
      }
      continue;
    }

    // Handles bash default assignments: : "${VAR:=VALUE}" or : "${VAR:-VALUE}"
    const startIdx = line.indexOf('${');
    if (startIdx === -1) continue;

    const colonIdx = line.indexOf(':=', startIdx);
    const dashIdx = line.indexOf(':-', startIdx);
    let opIdx = -1;
    let opLen = 2;
    if (colonIdx !== -1 && (dashIdx === -1 || colonIdx < dashIdx)) {
      opIdx = colonIdx;
    } else if (dashIdx !== -1) {
      opIdx = dashIdx;
    }

    if (opIdx === -1) continue;

    const key = line.substring(startIdx + 2, opIdx).trim();
    const valStart = opIdx + opLen;
    let depth = 1;
    let valEnd = -1;

    for (let i = valStart; i < line.length; i++) {
      const ch = line[i];
      if (ch === '{' && line[i - 1] === '$') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          valEnd = i;
          break;
        }
      }
    }

    if (valEnd !== -1) {
      let val = line.substring(valStart, valEnd);
      val = val.replace(/^["']|["']$/g, '').trim();
      env[key] = val;
    }
  }

  // Resolve self-referencing variables in defaults (e.g. THIS_DOMAIN=${THIS_NAME}.${THIS_TLD})
  let resolved = false;
  let iterations = 0;
  while (!resolved && iterations < 5) {
    resolved = true;
    iterations++;
    for (const [k, v] of Object.entries(env)) {
      if (v.includes('$')) {
        const sub = substituteVariables(v, env);
        if (sub !== v) {
          env[k] = sub;
          resolved = false;
        }
      }
    }
  }

  return env;
}

/**
 * Parses standard .env files
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      const [, key, val] = match;
      result[key] = val.replace(/^["']|["']$/g, '').trim();
    }
  }
  return result;
}

/**
 * Parses .env.enabler file into boolean map
 */
export function parseEnablerFile(content: string): Record<string, boolean> {
  const enablers: Record<string, boolean> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)=(true|false)$/i);
    if (match) {
      enablers[match[1].toUpperCase()] = match[2].toLowerCase() === 'true';
    }
  }
  return enablers;
}

/**
 * Loads entire configuration from project root directory
 */
export function loadProjectConfig(projectRoot: string): VowConfig {
  const defaultEnvPath = path.join(projectRoot, 'src', 'default.env');
  const userEnvPath = path.join(projectRoot, '.env');
  const enablerPath = path.join(projectRoot, '.env.enabler');
  const exampleEnablerPath = path.join(projectRoot, 'src', 'example.env.enabler');

  let configMap: Record<string, string> = {};

  if (fs.existsSync(defaultEnvPath)) {
    const defaultContent = fs.readFileSync(defaultEnvPath, 'utf-8');
    configMap = parseDefaultEnv(defaultContent);
  }

  if (fs.existsSync(userEnvPath)) {
    const userContent = fs.readFileSync(userEnvPath, 'utf-8');
    const userMap = parseEnvFile(userContent);
    configMap = { ...configMap, ...userMap };
  }

  // Resolve any remaining variable references iteratively
  let resolved = false;
  let iterations = 0;
  while (!resolved && iterations < 5) {
    resolved = true;
    iterations++;
    for (const [k, v] of Object.entries(configMap)) {
      if (typeof v === 'string' && v.includes('$')) {
        const sub = substituteVariables(v, configMap);
        if (sub !== v) {
          configMap[k] = sub;
          resolved = false;
        }
      }
    }
  }

  // Load enablers
  let enablers: Record<string, boolean> = {};
  if (fs.existsSync(enablerPath)) {
    enablers = parseEnablerFile(fs.readFileSync(enablerPath, 'utf-8'));
  } else if (fs.existsSync(exampleEnablerPath)) {
    enablers = parseEnablerFile(fs.readFileSync(exampleEnablerPath, 'utf-8'));
  }

  const k8sType = (configMap['THIS_K8S_TYPE'] || 'kind').toLowerCase() as 'kind' | 'k3d' | 'k3s';
  const ingress = (configMap['THIS_CLUSTER_INGRESS'] || 'nginx').toLowerCase() as 'nginx' | 'traefik' | 'haproxy';
  const domain = configMap['THIS_DOMAIN'] || 'example.com';
  const namespace = configMap['THIS_NAMESPACE'] || 'default';
  const adminUser = configMap['THIS_ADMIN_USER'] || 'myadmin';
  const rawRunner = (configMap['THIS_CD_RUNNER'] || 'argocd').toLowerCase();
  const cdRunner: 'argocd' | 'flux' | 'both' =
    rawRunner === 'flux' || rawRunner === 'fluxcd'
      ? 'flux'
      : rawRunner === 'both'
      ? 'both'
      : 'argocd';
  const fluxNamespace = configMap['THIS_FLUX_NAMESPACE'] || 'flux-system';
  const clusterIssuer = configMap['THIS_CLUSTER_ISSUER'] || 'mkcert-issuer';
  const rawChartsDir = configMap['THIS_CHARTS_DIR'] || configMap['LOCAL_CHARTS_DIR'] || configMap['CHARTS_DIR'] || './charts';
  const resolvedChartsDir = path.isAbsolute(rawChartsDir) ? rawChartsDir : path.resolve(projectRoot, rawChartsDir);

  const appDomains: Record<string, string> = {
    monitaur: configMap['THIS_MONITAUR_DOMAIN'] || 'portal.monitaur.net',
    fitdjinn: configMap['THIS_FITDJINN_DOMAIN'] || 'portal.fitdjinn.com',
    bokbot: configMap['THIS_BOKBOT_DOMAIN'] || 'portal.bokbot.com',
    ironcladgrants: configMap['THIS_IRONCLADGRANTS_DOMAIN'] || 'portal.ironcladgrants.com',
    syncromancer: configMap['THIS_SYNCROMANCER_DOMAIN'] || 'portal.syncromancer.com',
    billamadotnet: configMap['THIS_BILLAMADOTNET_DOMAIN'] || 'billama.net',
    billama: configMap['THIS_BILLAMA_DOMAIN'] || 'portal.billama.net',
  };

  return {
    raw: configMap,
    enablers,
    chartsDir: resolvedChartsDir,
    cluster: {
      k8sPlatform: k8sType,
      ingress,
      cdRunner,
      clusterIssuer,
      domain,
      namespace,
      adminUser,
      fluxNamespace,
      chartsDir: resolvedChartsDir,
      appDomains,
    },
  };
}

/**
 * Gets the configured domain for a specific application
 */
export function getAppDomain(projectRoot: string, appId: string): string | undefined {
  const config = loadProjectConfig(projectRoot);
  const normalized = appId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return config.cluster.appDomains?.[normalized] || config.cluster.appDomains?.[appId];
}

/**
 * Sets the configured domain for a specific application in .env
 */
export function setAppDomain(projectRoot: string, appId: string, domain: string): void {
  const current = loadProjectConfig(projectRoot);
  const envVar = `THIS_${appId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_DOMAIN`;
  const updated = {
    ...current.raw,
    [envVar]: domain,
  };
  saveEnvFile(projectRoot, updated);
}

/**
 * Gets the resolved local Helm charts directory path
 */
export function getChartsDirectory(projectRoot: string): string {
  const config = loadProjectConfig(projectRoot);
  return config.chartsDir;
}

/**
 * Sets the local Helm charts directory path in .env
 */
export function setChartsDirectory(projectRoot: string, newPath: string): void {
  const current = loadProjectConfig(projectRoot);
  const updated = {
    ...current.raw,
    THIS_CHARTS_DIR: newPath,
  };
  saveEnvFile(projectRoot, updated);
}

/**
 * Saves updated .env file to disk
 */
export function saveEnvFile(projectRoot: string, envMap: Record<string, string>): void {
  const envPath = path.join(projectRoot, '.env');
  const lines: string[] = ['# Generated by Vigilant Octo Waffle Control Plane', ''];
  for (const [k, v] of Object.entries(envMap)) {
    // Validate key identifier (must start with letter/underscore and contain alphanumeric/underscore)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    // Sanitize value: escape double quotes, strip raw newlines to prevent multi-line injection
    const sanitizedVal = String(v ?? '')
      .replace(/"/g, '\\"')
      .replace(/[\r\n]+/g, ' ');
    lines.push(`${k}="${sanitizedVal}"`);
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Saves updated .env.enabler file to disk
 */
export function saveEnablerFile(projectRoot: string, enablers: Record<string, boolean>): void {
  const enablerPath = path.join(projectRoot, '.env.enabler');
  const lines: string[] = ['# Application toggles for Vigilant Octo Waffle', ''];
  for (const [k, v] of Object.entries(enablers)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    lines.push(`${k}=${Boolean(v)}`);
  }
  fs.writeFileSync(enablerPath, lines.join('\n') + '\n', 'utf-8');
}
