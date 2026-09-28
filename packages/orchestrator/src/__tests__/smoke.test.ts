import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  validateCommand,
  ALLOWED_EXECUTABLES,
  generateRandomSecret,
  generateClusterSecrets,
  loadProjectConfig,
  saveEnvFile,
  saveEnablerFile,
} from '../index.js';

describe('Orchestrator Security & Smoke Tests', () => {
  const projectRoot = path.resolve(process.cwd(), '../..');

  describe('Command Validation & Allowlist', () => {
    it('allows all approved standard binaries', () => {
      for (const binary of ALLOWED_EXECUTABLES) {
        const res = validateCommand(binary, ['--help'], projectRoot);
        assert.equal(res.allowed, true, `Expected ${binary} to be allowed`);
        assert.equal(res.normalizedCommand, binary);
      }
    });

    it('allows project scripts (up and src/*.sh)', () => {
      const upRes = validateCommand('up', [], projectRoot);
      assert.equal(upRes.allowed, true, 'Expected "up" to be allowed');

      const hostrRes = validateCommand('bash', ['src/hostr.sh'], projectRoot);
      assert.equal(hostrRes.allowed, true, 'Expected "bash src/hostr.sh" to be allowed');
    });

    it('rejects arbitrary dangerous binaries', () => {
      const dangerous = ['rm', 'curl', 'wget', 'python', 'perl', 'nc', 'sh', 'cat'];
      for (const cmd of dangerous) {
        const res = validateCommand(cmd, ['-rf', '/'], projectRoot);
        assert.equal(res.allowed, false, `Expected ${cmd} to be blocked`);
        assert.match(res.reason || '', /allowlist/i);
      }
    });

    it('strictly rejects bash -c and evaluation flags', () => {
      const cRes = validateCommand('bash', ['-c', 'rm -rf /'], projectRoot);
      assert.equal(cRes.allowed, false);
      assert.match(cRes.reason || '', /forbidden/i);

      const sRes = validateCommand('bash', ['-s'], projectRoot);
      assert.equal(sRes.allowed, false);
    });

    it('rejects directory traversal in script execution', () => {
      const travRes = validateCommand('bash', ['../../etc/shadow'], projectRoot);
      assert.equal(travRes.allowed, false);
      assert.match(travRes.reason || '', /repository root/i);
    });
  });

  describe('Secret Generation (Unbiased Randomness)', () => {
    it('generates secrets of exact requested length', () => {
      const secret24 = generateRandomSecret(24);
      assert.equal(secret24.length, 24);
      assert.match(secret24, /^[A-Za-z0-9]+$/);

      const secret48 = generateRandomSecret(48, 'all');
      assert.equal(secret48.length, 48);
    });

    it('generates distinct secrets without collision', () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) {
        set.add(generateRandomSecret(16));
      }
      assert.equal(set.size, 50, 'All 50 generated secrets should be unique');
    });

    it('generates complete cluster secret suite', () => {
      const secrets = generateClusterSecrets({
        secretName: 'test-secrets',
        namespace: 'test-ns',
      });
      assert.equal(secrets.secretName, 'test-secrets');
      assert.equal(secrets.namespace, 'test-ns');
      assert.ok(secrets.items['argocdadmin-password']);
      assert.ok(secrets.secretYaml.includes('kind: Secret'));
    });
  });

  describe('Config Parsing & Sanitization', () => {
    it('loads project config and parses defaults correctly', () => {
      const config = loadProjectConfig(projectRoot);
      assert.ok(config.raw);
      assert.ok(config.cluster);
      assert.ok(['kind', 'k3d', 'k3s'].includes(config.cluster.k8sPlatform));
    });

    it('sanitizes environment keys during file generation', () => {
      // Test that invalid keys and injection strings are handled cleanly
      const testMap: Record<string, string> = {
        VALID_KEY: 'safe_value',
        'INVALID;INJECTED': 'malicious',
        ANOTHER_KEY: 'value "with" quotes\nand newlines',
      };

      // saveEnvFile to a scratch/mock path
      const tmpDir = path.resolve(projectRoot, '.vow-cache/test');
      import('node:fs').then((fs) => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        saveEnvFile(tmpDir, testMap);
        const written = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
        assert.ok(written.includes('VALID_KEY="safe_value"'));
        assert.ok(!written.includes('INVALID;INJECTED'));
        assert.ok(!written.includes('\nand newlines\n'));
      });
    });
  });
});
