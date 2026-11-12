/**
 * K3s node join: server/token resolution, join scripts, SSH and batch provisioning (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from '../config.js';
import { processManager, type TaskRun } from '../executor.js';
import { assertK8sLabel } from '../exec-argv.js';

// ---------------------------------------------------------------------------
// Shell quoting + identifier validation for the generated join artifacts.
// The one-liners and scripts below are executed by a shell (locally pasted
// or piped to `sudo bash -s` on a remote node), so every interpolated value
// must be either a validated identifier or a safely quoted word. Previously
// all values were interpolated raw: a nodeName, token, or URL containing
// `;`, `$(...)`, quotes, or newlines executed as shell code.
// ---------------------------------------------------------------------------

/**
 * shlex.quote semantics for a single shell word: words made only of safe
 * characters pass through unchanged (so benign one-liners/scripts stay
 * byte-identical), anything else is wrapped in single quotes with embedded
 * single quotes escaped as '\''. A leading `-` also forces quoting so a
 * value can never be reinterpreted as a flag.
 */
export function shellQuote(value: string): string {
  if (value.length > 0 && !value.startsWith('-') && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quoting for `NAME=value` env assignments in the generated artifacts.
 * Values that cannot expand inside double quotes keep the historical
 * `NAME="value"` form; anything containing `$`, backtick, `"`, `\`, `!`,
 * or a newline is emitted single-quoted via shellQuote instead, so a
 * hostile token or URL can never break out of the assignment.
 */
export function shellQuoteEnvValue(value: string): string {
  if (/^[^$`"\\!\n]*$/.test(value)) {
    return `"${value}"`;
  }
  return shellQuote(value);
}

/** Kubernetes label key: optional DNS-subdomain prefix + `/` + name. */
const K8S_LABEL_KEY = /^(?:[a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
/** Kubernetes label value: empty, or alphanumerics with `-`, `_`, `.` inside. */
const K8S_LABEL_VALUE = /^([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/;

function assertK8sLabelPair(pair: string, what: string): void {
  const eq = pair.indexOf('=');
  if (eq <= 0) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(pair)} (expected key=value)`);
  }
  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  if (
    key.length > 253 ||
    value.length > 63 ||
    !K8S_LABEL_KEY.test(key) ||
    !K8S_LABEL_VALUE.test(value)
  ) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(pair)} (expected a Kubernetes label key=value)`);
  }
}

function assertK8sTaint(taint: string): void {
  const colon = taint.lastIndexOf(':');
  if (colon <= 0) {
    throw new Error(`Invalid node taint: ${JSON.stringify(taint)} (expected key=value:effect or key:effect)`);
  }
  const kv = taint.slice(0, colon);
  const effect = taint.slice(colon + 1);
  if (effect !== 'NoSchedule' && effect !== 'PreferNoSchedule' && effect !== 'NoExecute') {
    throw new Error(`Invalid node taint effect: ${JSON.stringify(effect)} (expected NoSchedule, PreferNoSchedule, or NoExecute)`);
  }
  if (kv.includes('=')) {
    assertK8sLabelPair(kv, 'node taint');
  } else if (!K8S_LABEL_KEY.test(kv) || kv.length > 253) {
    throw new Error(`Invalid node taint key: ${JSON.stringify(kv)} (expected a Kubernetes label key)`);
  }
}

/**
 * Builds the `--node-name/--node-ip/--node-label/--node-taint` flag words
 * for the join command, shared by the one-liner and the script generators
 * so they cannot diverge. Structured identifiers are validated (fail
 * closed); opaque values (node IP, extra args) are shell-quoted. Valid
 * identifiers quote to themselves, so benign output is unchanged.
 */
function buildJoinFlags(options: K3sJoinOptions): string {
  const flags: string[] = [];
  if (options.nodeName) {
    flags.push('--node-name', shellQuote(assertK8sLabel(options.nodeName, 'node name')));
  }
  if (options.nodeIp) {
    flags.push('--node-ip', shellQuote(options.nodeIp));
  }
  if (options.labels) {
    for (const [k, v] of Object.entries(options.labels)) {
      if (k && v) {
        assertK8sLabelPair(`${k}=${v}`, 'node label');
        flags.push('--node-label', shellQuote(`${k}=${v}`));
      }
    }
  }
  if (options.taints && options.taints.length > 0) {
    for (const t of options.taints) {
      if (t) {
        assertK8sTaint(t);
        flags.push('--node-taint', shellQuote(t));
      }
    }
  }
  if (options.extraArgs && options.extraArgs.length > 0) {
    // Each element is one word: a multi-word element used to split into
    // several words (and could inject flags/commands); quoting keeps it a
    // single argument. No in-repo caller passes extraArgs today.
    for (const a of options.extraArgs) {
      if (a) flags.push(shellQuote(a));
    }
  }
  return flags.length > 0 ? ` ${flags.join(' ')}` : '';
}

export type K3sNodeRole = 'agent' | 'server';

export interface K3sJoinOptions {
  role?: K3sNodeRole;
  serverUrl?: string;
  serverIp?: string;
  token?: string;
  nodeName?: string;
  nodeIp?: string;
  labels?: Record<string, string>;
  taints?: string[];
  flannelBackend?: string;
  extraArgs?: string[];
}

export interface K3sJoinInfo {
  serverUrl: string;
  serverIp: string;
  token: string;
  tokenMasked: string;
  agentOneLiner: string;
  serverOneLiner: string;
  agentScript: string;
  serverScript: string;
}

export interface K3sSshProvisionOptions {
  targetHost: string; // e.g. "ubuntu@192.168.1.50"
  role?: K3sNodeRole;
  port?: number;
  sshKey?: string;
  serverUrl?: string;
  token?: string;
  nodeName?: string;
  nodeIp?: string;
  labels?: Record<string, string>;
  taints?: string[];
  tune?: boolean;
  copyRegistries?: boolean;
  registriesFile?: string;
  copyKubeconfig?: boolean;
}

/**
 * Resolves the active K3s cluster server URL and IP
 */
export function resolveK3sServer(projectRoot: string, overrideUrl?: string, overrideIp?: string): { serverIp: string; serverUrl: string } {
  if (overrideUrl && overrideUrl.trim()) {
    const raw = overrideUrl.trim();
    const url = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}:6443`;
    const host = url.replace(/^https?:\/\//, '').split(':')[0] || '127.0.0.1';
    return { serverIp: host, serverUrl: url };
  }

  if (overrideIp && overrideIp.trim()) {
    const ip = overrideIp.trim();
    return { serverIp: ip, serverUrl: `https://${ip}:6443` };
  }

  const config = loadProjectConfig(projectRoot);
  const cfgServerIp = config.raw['THIS_K3S_SERVER_IP'] || config.raw['THIS_IP'];
  if (cfgServerIp && cfgServerIp.trim()) {
    const ip = cfgServerIp.trim();
    return { serverIp: ip, serverUrl: `https://${ip}:6443` };
  }

  // Check .secrets/k3s_env
  const k3sEnvPath = path.join(projectRoot, '.secrets', 'k3s_env');
  if (fs.existsSync(k3sEnvPath)) {
    try {
      const content = fs.readFileSync(k3sEnvPath, 'utf-8');
      const match = content.match(/export\s+K3S_URL=['"]([^'"]+)['"]/);
      if (match && match[1]) {
        const url = match[1];
        const host = url.replace(/^https?:\/\//, '').split(':')[0] || '127.0.0.1';
        return { serverIp: host, serverUrl: url };
      }
    } catch {
      // ignore
    }
  }

  return { serverIp: '127.0.0.1', serverUrl: 'https://127.0.0.1:6443' };
}

/**
 * Resolves the K3s node join token from config or .secrets
 */
export function resolveK3sToken(projectRoot: string, overrideToken?: string): string {
  if (overrideToken && overrideToken.trim()) {
    return overrideToken.trim();
  }

  const config = loadProjectConfig(projectRoot);
  if (config.raw['THIS_K3S_NODE_TOKEN'] && config.raw['THIS_K3S_NODE_TOKEN'].trim()) {
    return config.raw['THIS_K3S_NODE_TOKEN'].trim();
  }

  // Check .secrets/k3s_token
  const tokenFilePath = path.join(projectRoot, '.secrets', 'k3s_token');
  if (fs.existsSync(tokenFilePath)) {
    try {
      const tok = fs.readFileSync(tokenFilePath, 'utf-8').trim();
      if (tok) return tok;
    } catch {}
  }

  // Check .secrets/k3s_env
  const envFilePath = path.join(projectRoot, '.secrets', 'k3s_env');
  if (fs.existsSync(envFilePath)) {
    try {
      const content = fs.readFileSync(envFilePath, 'utf-8');
      const match = content.match(/export\s+K3S_TOKEN=['"]([^'"]+)['"]/);
      if (match && match[1]) return match[1].trim();
    } catch {}
  }

  // Check system token if on k3s host
  const systemTokenPath = '/var/lib/rancher/k3s/server/node-token';
  if (fs.existsSync(systemTokenPath)) {
    try {
      const tok = fs.readFileSync(systemTokenPath, 'utf-8').trim();
      if (tok) return tok;
    } catch {}
  }

  return '';
}

/**
 * Generates single-line curl join command for copy-pasting onto a node
 */
export function generateK3sOneLiner(options: K3sJoinOptions): string {
  const role = options.role === 'server' ? 'server' : 'agent';
  const serverUrl = options.serverUrl || 'https://127.0.0.1:6443';
  const token = options.token || '';

  const flagsStr = buildJoinFlags(options);

  return `curl -sfL https://get.k3s.io | K3S_URL=${shellQuoteEnvValue(serverUrl)} K3S_TOKEN=${shellQuoteEnvValue(token)} sh -s - ${role}${flagsStr}`;
}

/**
 * Generates complete bash join script for a worker or server node
 */
export function generateK3sJoinScript(options: K3sJoinOptions): string {
  // Role is a closed set: anything else normalizes to agent so it can never
  // inject text into the script body (previously interpolated raw).
  const role = options.role === 'server' ? 'server' : 'agent';
  const serverUrl = options.serverUrl || 'https://127.0.0.1:6443';
  const token = options.token || '';

  const flagsStr = buildJoinFlags(options);
  const now = new Date().toISOString();
  // The header comment is not a quoted context: strip newlines so a hostile
  // URL cannot smuggle command lines into the script body.
  const commentServerUrl = serverUrl.replace(/[\r\n]/g, '');

  return `#!/usr/bin/env bash
# ==============================================================================
# K3s Node Join Script (${role.toUpperCase()})
# Generated: ${now}
# Primary Server: ${commentServerUrl}
# ==============================================================================
set -euo pipefail

export K3S_URL=${shellQuoteEnvValue(serverUrl)}
export K3S_TOKEN=${shellQuoteEnvValue(token)}

# Verify root privileges
if [[ $(id -u) -ne 0 ]]; then
  echo "Error: K3s node join must be run as root (or via sudo)." >&2
  exit 1
fi

echo "==> Joining K3s cluster at \${K3S_URL} as ${role} node..."

# Check network connectivity
SERVER_HOST=$(echo "\${K3S_URL}" | sed -e 's|^[^/]*//||' -e 's|:.*||')
SERVER_PORT=$(echo "\${K3S_URL}" | sed -e 's|^[^/]*//||' -e 's|.*:||' -e 's|/.*||')
if [[ -z "\${SERVER_PORT}" || "\${SERVER_PORT}" == "\${SERVER_HOST}" ]]; then
  SERVER_PORT="6443"
fi

if command -v nc >/dev/null 2>&1; then
  if ! nc -z -w 3 "\${SERVER_HOST}" "\${SERVER_PORT}" 2>/dev/null; then
    echo "Warning: Unable to connect to \${SERVER_HOST}:\${SERVER_PORT}. Ensure port \${SERVER_PORT} is open in firewall." >&2
  fi
fi

# Download and install K3s
curl -sfL https://get.k3s.io | sh -s - ${role}${flagsStr}

echo "==> Node successfully joined to K3s cluster!"
`;
}

/**
 * Saves a generated join script safely to .secrets/
 */
export function saveK3sJoinScript(
  projectRoot: string,
  options: K3sJoinOptions,
  customFileName?: string
): { filePath: string; relativePath: string; script: string } {
  const role = options.role || 'agent';
  const defaultName = `k3s_join_${role}.sh`;
  const sanitizedName = (customFileName || defaultName).replace(/[^a-zA-Z0-9._-]/g, '_');

  const secretsDir = path.join(projectRoot, '.secrets');
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  }

  const targetPath = path.resolve(secretsDir, sanitizedName);
  // Ensure path containment
  if (!targetPath.startsWith(path.resolve(secretsDir) + path.sep)) {
    throw new Error('Target script path must reside within .secrets directory');
  }

  const script = generateK3sJoinScript(options);
  fs.writeFileSync(targetPath, script, { encoding: 'utf-8', mode: 0o700 });

  return {
    filePath: targetPath,
    relativePath: path.relative(projectRoot, targetPath),
    script,
  };
}

/**
 * Aggregates complete K3s join summary with commands and scripts
 */
export function getK3sJoinInfo(projectRoot: string, overrides?: Partial<K3sJoinOptions>): K3sJoinInfo {
  const { serverIp, serverUrl } = resolveK3sServer(projectRoot, overrides?.serverUrl, overrides?.serverIp);
  const token = resolveK3sToken(projectRoot, overrides?.token);

  let tokenMasked = '';
  if (token) {
    tokenMasked = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : '****';
  }

  const agentOpts: K3sJoinOptions = {
    role: 'agent',
    serverUrl,
    token,
    ...overrides,
  };

  const serverOpts: K3sJoinOptions = {
    role: 'server',
    serverUrl,
    token,
    ...overrides,
  };

  return {
    serverUrl,
    serverIp,
    token,
    tokenMasked,
    agentOneLiner: generateK3sOneLiner(agentOpts),
    serverOneLiner: generateK3sOneLiner(serverOpts),
    agentScript: generateK3sJoinScript(agentOpts),
    serverScript: generateK3sJoinScript(serverOpts),
  };
}

/**
 * Provisions a remote node over SSH using src/k3s_add_node.sh via the task executor
 */
export function provisionK3sNodeViaSsh(projectRoot: string, options: K3sSshProvisionOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_add_node.sh');
  const role = options.role || 'agent';

  // Validate targetHost identifier (e.g. user@hostname or user@ip or hostname)
  if (!options.targetHost || !/^[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(options.targetHost.trim())) {
    throw new Error('Invalid SSH target host format');
  }

  const args: string[] = [
    scriptPath,
    '--role',
    role,
    '--ssh',
    options.targetHost.trim(),
  ];

  if (options.port && options.port > 0) {
    args.push('--ssh-port', String(options.port));
  }

  if (options.sshKey && options.sshKey.trim()) {
    args.push('--ssh-key', options.sshKey.trim());
  }

  if (options.serverUrl && options.serverUrl.trim()) {
    args.push('--server', options.serverUrl.trim());
  }

  if (options.token && options.token.trim()) {
    args.push('--token', options.token.trim());
  }

  if (options.nodeName && options.nodeName.trim()) {
    args.push('--node-name', options.nodeName.trim());
  }

  if (options.nodeIp && options.nodeIp.trim()) {
    args.push('--node-ip', options.nodeIp.trim());
  }

  if (options.labels && Object.keys(options.labels).length > 0) {
    const labelPairs = Object.entries(options.labels)
      .filter(([k, v]) => k && v)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    if (labelPairs) args.push('--labels', labelPairs);
  }

  if (options.taints && options.taints.length > 0) {
    const taintList = options.taints.filter(Boolean).join(',');
    if (taintList) args.push('--taints', taintList);
  }

  if (options.tune) {
    args.push('--tune');
  }

  if (options.copyRegistries) {
    args.push('--copy-registries');
  }

  if (options.registriesFile && options.registriesFile.trim()) {
    args.push('--registries-file', options.registriesFile.trim());
  }

  if (options.copyKubeconfig) {
    args.push('--copy-kubeconfig');
  }

  return processManager.runCommand('bash', args, {
    cwd: projectRoot,
  });
}

export interface K3sBatchProvisionOptions {
  targetsFile?: string;
  targets?: string[];
  role?: K3sNodeRole;
  parallel?: number;
  tune?: boolean;
  copyRegistries?: boolean;
  registriesFile?: string;
  copyKubeconfig?: boolean;
  port?: number;
  sshKey?: string;
  serverUrl?: string;
  token?: string;
}

/**
 * Batch provisions multiple worker or control-plane nodes across targets
 */
export function provisionK3sBatchNodes(projectRoot: string, options: K3sBatchProvisionOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_add_node.sh');
  const role = options.role || 'agent';
  const args: string[] = [scriptPath, '--role', role];

  if (options.targetsFile && options.targetsFile.trim()) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }
  if (options.tune) {
    args.push('--tune');
  }
  if (options.copyRegistries) {
    args.push('--copy-registries');
  }
  if (options.registriesFile && options.registriesFile.trim()) {
    args.push('--registries-file', options.registriesFile.trim());
  }
  if (options.copyKubeconfig) {
    args.push('--copy-kubeconfig');
  }
  if (options.port && options.port > 0) {
    args.push('--ssh-port', String(options.port));
  }
  if (options.sshKey && options.sshKey.trim()) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options.serverUrl && options.serverUrl.trim()) {
    args.push('--server', options.serverUrl.trim());
  }
  if (options.token && options.token.trim()) {
    args.push('--token', options.token.trim());
  }
  if (options.targets && options.targets.length > 0) {
    for (const t of options.targets) {
      if (t && t.trim()) args.push(t.trim());
    }
  }

  // Precedence: an explicitly configured SERVER_URL in the process env
  // wins; the server_url file (written by install_k3s.sh) is the
  // fallback. Previously a stale file silently overrode a correct env
  // value. (The script itself now also honors the injected env — its
  // unconditional SERVER_URL="" assignment used to clobber this value.)
  let serverUrlEnv = process.env.SERVER_URL;
  if (!serverUrlEnv) {
    try {
      const serverUrlFile = path.join(projectRoot, 'server_url');
      if (fs.existsSync(serverUrlFile)) {
        serverUrlEnv = fs.readFileSync(serverUrlFile, 'utf8').trim() || undefined;
      }
    } catch {
      // ignore read errors
    }
  }

  return processManager.runCommand('bash', args, { 
    cwd: projectRoot,
    env: { ...process.env, ...(serverUrlEnv ? { SERVER_URL: serverUrlEnv } : {}) }
  });
}
