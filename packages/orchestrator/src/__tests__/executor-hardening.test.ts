/**
 * Regression tests for the 2026-10-14 bug sweep (executor hardening):
 * - validateCommand previously validated only the binary NAME, so
 *   argument-level code execution (git -c, ssh -o ProxyCommand,
 *   docker run, helm --post-renderer, kubectl --server/exec) passed.
 * - A child 'error' was re-emitted on the task emitter, which has no
 *   'error' listeners anywhere — Node throws on unlistened 'error'.
 * - cancelTask's 'cancelled' status was overwritten by the child's
 *   later close event, and nothing escalated past SIGTERM.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProcessManager, validateCommand } from '../executor.js';

const cwd = process.cwd();

describe('validateCommand argument policy', () => {
  const rejected: Array<[string, string[]]> = [
    ['git', ['-c', 'core.sshCommand=id', 'clone', 'https://example.com/x.git']],
    ['git', ['clone', 'ext::sh -c id']],
    ['git', ['--upload-pack=touch /tmp/pwn', 'clone', 'x']],
    ['ssh', ['-o', 'ProxyCommand=id', 'host']],
    ['ssh', ['-oProxyCommand=id', 'host']],
    ['ssh', ['-F', '/tmp/evilconfig', 'host']],
    ['scp', ['-S', '/tmp/evil', 'a', 'host:/tmp/']],
    ['scp', ['-o', 'LocalCommand=id', 'a', 'host:/tmp/']],
    ['docker', ['run', '--privileged', '-v', '/:/host', 'alpine']],
    ['docker', ['exec', 'abc', 'sh']],
    ['docker', ['compose', 'up']],
    ['helm', ['upgrade', '--install', '--post-renderer', '/tmp/evil', 'rel', 'chart']],
    ['kubectl', ['--server', 'https://evil.example', 'get', 'pods']],
    ['kubectl', ['exec', 'pod', '--', 'sh']],
    ['kubectl', ['cp', 'pod:/etc/passwd', '/tmp/passwd']],
    ['parallel', ['--version']],
  ];
  for (const [cmd, args] of rejected) {
    it(`rejects ${cmd} ${args.join(' ')}`, () => {
      const res = validateCommand(cmd, args, cwd);
      assert.equal(res.allowed, false, res.reason ?? 'expected rejection');
    });
  }

  const allowed: Array<[string, string[]]> = [
    ['git', ['status']],
    ['git', ['clone', 'https://example.com/x.git', 'dir']],
    ['ssh', ['-p', '22', 'ubuntu@192.168.1.50']],
    ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'host']],
    ['scp', ['file.txt', 'root@192.168.1.50:/tmp/']],
    ['docker', ['build', '-t', 'img:tag', '.']],
    ['docker', ['images']],
    ['docker', ['push', 'localhost:5001/img:tag']],
    ['helm', ['list', '-A']],
    ['kubectl', ['get', 'pods', '-A']],
    ['kubectl', ['rollout', 'status', 'deployment/x', '-n', 'default']],
  ];
  for (const [cmd, args] of allowed) {
    it(`allows ${cmd} ${args.join(' ')}`, () => {
      const res = validateCommand(cmd, args, cwd);
      assert.equal(res.allowed, true, res.reason ?? 'expected allowed');
    });
  }
});

describe('ProcessManager lifecycle', () => {
  let binDir: string;
  let workDir: string;

  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-fakebin-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-work-'));
    // Fake `kubectl` binaries so the tests do not depend on real CLIs.
    fs.writeFileSync(
      path.join(binDir, 'kubectl'),
      '#!/bin/bash\nif [ "$1" = "sleeper" ]; then exec sleep 30; fi\nif [ "$1" = "stubborn" ]; then trap "" TERM; while true; do sleep 1; done; fi\nexit 0\n',
      { mode: 0o755 }
    );
  });

  after(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  // Fake bin dir FIRST so our kubectl wins, real PATH retained so the
  // script's own `sleep` still resolves.
  const env = () => ({ PATH: `${binDir}:${process.env.PATH ?? ''}` });

  async function waitFor(fn: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  it('spawn failure fails the task instead of throwing via an unlistened error event', async () => {
    const pm = new ProcessManager();
    const task = pm.runCommand('kubectl', ['get', 'nodes'], {
      cwd: workDir,
      env: { PATH: '/nonexistent-vow-dir' },
    });
    // No 'error' listener is attached — before the fix, the child's
    // ENOENT re-emit threw an uncaught exception here.
    await waitFor(() => task.status !== 'running', 5000, 'task to fail');
    assert.equal(task.status, 'failed');
  });

  it('cancel is final: the later close event does not overwrite cancelled', async () => {
    const pm = new ProcessManager();
    const task = pm.runCommand('kubectl', ['sleeper'], { cwd: workDir, env: env() });
    await waitFor(() => Boolean(task.childProcess), 2000, 'child to spawn');
    assert.equal(pm.cancelTask(task.id), true);
    assert.equal(task.status, 'cancelled');
    // Let the child actually die and its close handler run.
    await waitFor(
      () => task.logs.some((l) => l.message.includes('after cancellation')),
      5000,
      'post-cancel close handling'
    );
    assert.equal(task.status, 'cancelled');
  });

  it('cancel escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const pm = new ProcessManager();
    const task = pm.runCommand('kubectl', ['stubborn'], { cwd: workDir, env: env() });
    await waitFor(() => Boolean(task.childProcess), 2000, 'child to spawn');
    const pid = task.childProcess!.pid!;
    assert.equal(pm.cancelTask(task.id), true);
    await waitFor(
      () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      },
      9000,
      'stubborn child to be SIGKILLed'
    );
    assert.equal(task.status, 'cancelled');
  });

  it('timeoutMs terminates a hung task and records it failed', async () => {
    const pm = new ProcessManager();
    const task = pm.runCommand('kubectl', ['sleeper'], {
      cwd: workDir,
      env: env(),
      timeoutMs: 300,
    });
    await waitFor(() => task.status !== 'running', 8000, 'task to time out');
    assert.equal(task.status, 'failed');
    assert.ok(task.logs.some((l) => l.message.includes('timed out')));
  });
});
