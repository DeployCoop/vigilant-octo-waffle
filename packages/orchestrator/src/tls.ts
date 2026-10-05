import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findProjectRoot } from './config.js';

const execAsync = promisify(exec);

export interface DevCertificateInfo {
  certPath: string;
  keyPath: string;
  caroot: string;
  hostnames: string[];
}

export function getDevCertificatePaths(projectRoot: string = findProjectRoot()): {
  dir: string;
  certPath: string;
  keyPath: string;
} {
  const dir = path.join(projectRoot, '.vow', 'certs');
  return {
    dir,
    certPath: path.join(dir, 'dev-cert.pem'),
    keyPath: path.join(dir, 'dev-key.pem'),
  };
}

export function hasDevCertificate(projectRoot: string = findProjectRoot()): boolean {
  const { certPath, keyPath } = getDevCertificatePaths(projectRoot);
  try {
    const certStat = fs.statSync(certPath);
    const keyStat = fs.statSync(keyPath);
    return certStat.size > 0 && keyStat.size > 0;
  } catch {
    return false;
  }
}

export async function getMkcertCaRoot(): Promise<string> {
  try {
    const { stdout } = await execAsync('mkcert -CAROOT');
    return stdout.trim();
  } catch (err: any) {
    throw new Error(`Failed to query mkcert -CAROOT: ${err.message}`, { cause: err });
  }
}

export function discoverLocalHostnames(): string[] {
  const names = new Set<string>(['localhost', '127.0.0.1', '::1']);

  // Add system hostname
  try {
    const host = os.hostname();
    if (host) names.add(host);
  } catch {}

  // Add local IPv4/IPv6 network addresses
  try {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (!addr.internal && addr.family === 'IPv4') {
          names.add(addr.address);
        }
      }
    }
  } catch {}

  // Standard domain defaults for the datacenter / vigilant-octo-waffle
  names.add('monitaur.net');
  names.add('*.monitaur.net');

  return Array.from(names);
}

/**
 * Ensures a valid mkcert TLS certificate exists in `.vow/certs/`.
 * Generates one using the local mkcert CA if missing or empty.
 */
export async function ensureDevCertificate(
  projectRoot: string = findProjectRoot(),
  options: { hostnames?: string[]; force?: boolean } = {}
): Promise<DevCertificateInfo> {
  const { dir, certPath, keyPath } = getDevCertificatePaths(projectRoot);
  const caroot = await getMkcertCaRoot();

  if (!options.force && hasDevCertificate(projectRoot)) {
    return {
      certPath,
      keyPath,
      caroot,
      hostnames: options.hostnames || discoverLocalHostnames(),
    };
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const hostnames = Array.from(
    new Set([...discoverLocalHostnames(), ...(options.hostnames || [])])
  );

  const quotedHosts = hostnames.map((h) => JSON.stringify(h)).join(' ');
  const cmd = `mkcert -cert-file ${JSON.stringify(certPath)} -key-file ${JSON.stringify(keyPath)} ${quotedHosts}`;

  try {
    await execAsync(cmd, { cwd: projectRoot });
    fs.chmodSync(keyPath, 0o600);
  } catch (err: any) {
    throw new Error(`Failed to generate mkcert certificate: ${err.message}`, { cause: err });
  }

  return {
    certPath,
    keyPath,
    caroot,
    hostnames,
  };
}
