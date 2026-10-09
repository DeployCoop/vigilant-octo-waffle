#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  findProjectRoot,
  isAuthzEnabled,
  ensureDevCertificate,
  getDevCertificatePaths,
} from '@vow/orchestrator';

const projectRoot = findProjectRoot();
const authEnabled = isAuthzEnabled(projectRoot, process.env);

const nextBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/.bin/next'
);

const args = ['dev', '--turbopack'];

if (authEnabled) {
  try {
    ensureDevCertificate(projectRoot);
    const { certPath, keyPath } = getDevCertificatePaths(projectRoot);
    console.log('[VOW] Authorization is ENABLED: Launching Next.js with TLS (HTTPS) via mkcert');
    args.push(
      '--experimental-https',
      '--experimental-https-key',
      keyPath,
      '--experimental-https-cert',
      certPath
    );
  } catch (err) {
    console.warn('[VOW] Warning: Failed to generate/load TLS certificate, falling back to HTTP:', err);
  }
} else {
  console.log('[VOW] Authorization is DISABLED: Launching Next.js in plain HTTP mode');
}

// Forward any extra command-line flags
args.push(...process.argv.slice(2));

const child = spawn(nextBin, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
}
