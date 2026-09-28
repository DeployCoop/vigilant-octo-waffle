import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig } from './config.js';
import { processManager, type TaskRun } from './executor.js';

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
  const role = options.role || 'agent';
  const serverUrl = options.serverUrl || 'https://127.0.0.1:6443';
  const token = options.token || '';

  const extraFlags: string[] = [];
  if (options.nodeName) extraFlags.push(`--node-name ${options.nodeName}`);
  if (options.nodeIp) extraFlags.push(`--node-ip ${options.nodeIp}`);
  if (options.labels) {
    for (const [k, v] of Object.entries(options.labels)) {
      if (k && v) extraFlags.push(`--node-label ${k}=${v}`);
    }
  }
  if (options.taints && options.taints.length > 0) {
    for (const t of options.taints) {
      if (t) extraFlags.push(`--node-taint ${t}`);
    }
  }
  if (options.extraArgs && options.extraArgs.length > 0) {
    extraFlags.push(...options.extraArgs);
  }

  const flagsStr = extraFlags.length > 0 ? ` ${extraFlags.join(' ')}` : '';

  if (role === 'agent') {
    return `curl -sfL https://get.k3s.io | K3S_URL="${serverUrl}" K3S_TOKEN="${token}" sh -s - agent${flagsStr}`;
  } else {
    return `curl -sfL https://get.k3s.io | K3S_URL="${serverUrl}" K3S_TOKEN="${token}" sh -s - server${flagsStr}`;
  }
}

/**
 * Generates complete bash join script for a worker or server node
 */
export function generateK3sJoinScript(options: K3sJoinOptions): string {
  const role = options.role || 'agent';
  const serverUrl = options.serverUrl || 'https://127.0.0.1:6443';
  const token = options.token || '';

  const extraFlags: string[] = [];
  if (options.nodeName) extraFlags.push(`--node-name ${options.nodeName}`);
  if (options.nodeIp) extraFlags.push(`--node-ip ${options.nodeIp}`);
  if (options.labels) {
    for (const [k, v] of Object.entries(options.labels)) {
      if (k && v) extraFlags.push(`--node-label ${k}=${v}`);
    }
  }
  if (options.taints && options.taints.length > 0) {
    for (const t of options.taints) {
      if (t) extraFlags.push(`--node-taint ${t}`);
    }
  }
  if (options.extraArgs && options.extraArgs.length > 0) {
    extraFlags.push(...options.extraArgs);
  }

  const flagsStr = extraFlags.length > 0 ? ` ${extraFlags.join(' ')}` : '';
  const now = new Date().toISOString();

  return `#!/usr/bin/env bash
# ==============================================================================
# K3s Node Join Script (${role.toUpperCase()})
# Generated: ${now}
# Primary Server: ${serverUrl}
# ==============================================================================
set -euo pipefail

export K3S_URL="${serverUrl}"
export K3S_TOKEN="${token}"

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

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sTuneOptions {
  remoteHost?: string;
  targetsFile?: string;
  sshPort?: number;
  sshKey?: string;
}

/**
 * Tunes node OS limits (nofile, inotify, sysctl)
 */
export function tuneK3sNode(projectRoot: string, options?: K3sTuneOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_tune.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sKmodOptions {
  remoteHost?: string;
  targetsFile?: string;
  sshPort?: number;
  sshKey?: string;
  modules?: string[];
}

/**
 * Provisions required kernel modules (nvme_tcp, nvme_fabrics, etc.)
 */
export function kmodK3sNode(projectRoot: string, options?: K3sKmodOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_kmod.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options?.modules && options.modules.length > 0) {
    args.push(...options.modules);
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sPingOptions {
  targetsFile?: string;
  remoteHost?: string;
  sshPort?: number;
  sshKey?: string;
  parallel?: number;
}

/**
 * Pings cluster nodes over SSH to check hostname, uptime, and network health
 */
export function pingK3sNodes(projectRoot: string, options?: K3sPingOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_ping.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--ssh', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sKillOptions {
  local?: boolean;
  all?: boolean;
  remoteHost?: string;
  targetsFile?: string;
  parallel?: number;
  sshPort?: number;
  sshKey?: string;
}

/**
 * Tears down and uninstalls K3s cluster nodes
 */
export function killK3sCluster(projectRoot: string, options?: K3sKillOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_kill.sh');
  const args: string[] = [scriptPath, '-y'];

  if (options?.all) {
    args.push('--all');
  } else if (options?.local) {
    args.push('--local');
  }
  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sBuildOptions {
  rebuild?: boolean;
  targetsFile?: string;
  parallel?: number;
  skipJoin?: boolean;
  skipTune?: boolean;
  skipUp?: boolean;
  registriesFile?: string;
}

/**
 * Builds or rebuilds an entire K3s cluster end-to-end
 */
export function buildK3sCluster(projectRoot: string, options?: K3sBuildOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_build.sh');
  const args: string[] = [scriptPath, '-y'];

  if (options?.rebuild) {
    args.push('--rebuild');
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }
  if (options?.skipJoin) {
    args.push('--skip-join');
  }
  if (options?.skipTune) {
    args.push('--skip-tune');
  }
  if (options?.skipUp) {
    args.push('--skip-up');
  }
  if (options?.registriesFile) {
    args.push('--registries-file', options.registriesFile.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sRegistriesOptions {
  remoteHost?: string;
  targetsFile?: string;
  registriesFile?: string;
  copyKubeconfig?: boolean;
  sshPort?: number;
  sshKey?: string;
}

/**
 * Deploys container registry mirrors and auth configuration
 */
export function deployK3sRegistries(projectRoot: string, options?: K3sRegistriesOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_registries.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.registriesFile) {
    args.push('--file', options.registriesFile.trim());
  }
  if (options?.copyKubeconfig) {
    args.push('--copy-kubeconfig');
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sUpOptions {
  targetsFile?: string;
  parallel?: number;
  skipJoin?: boolean;
  skipTune?: boolean;
  runPlatformUp?: boolean;
  registriesFile?: string;
}

/**
 * Canonical bring-up for a tuned K3s cluster with multi-node batch provisioning
 */
export function upK3sCluster(projectRoot: string, options?: K3sUpOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_up.sh');
  const args: string[] = [scriptPath];

  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }
  if (options?.skipJoin) {
    args.push('--skip-join');
  }
  if (options?.skipTune) {
    args.push('--skip-tune');
  }
  if (options?.runPlatformUp) {
    args.push('--run-platform-up');
  }
  if (options?.registriesFile) {
    args.push('--registries-file', options.registriesFile.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

