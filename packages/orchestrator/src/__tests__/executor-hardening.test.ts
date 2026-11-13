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
import { ProcessManager, validateCommand, assertCommandSuccess } from '../executor.js';
import { TaskStore, taskToRecord } from '../taskStore.js';

const cwd = process.cwd();

describe('validateCommand argument policy', () => {
  const rejected: Array<[string, string[]]> = [
    ['git', ['-c', 'core.sshCommand=id', 'clone', 'https://example.com/x.git']],
    ['git', ['clone', 'ext::sh -c id']],
    ['git', ['--upload-pack=touch /tmp/pwn', 'clone', 'x']],
    // Batch A6: attached -c form.
    ['git', ['-cuser.name=X', 'status']],
    ['ssh', ['-o', 'ProxyCommand=id', 'host']],
    ['ssh', ['-oProxyCommand=id', 'host']],
    // Batch A6: -o space form with no '=' — the old key extraction read
    // 'proxycommand id' and missed the blocklist.
    ['ssh', ['-o', 'ProxyCommand id', 'host']],
    ['ssh', ['-o', 'LocalCommand id', 'host']],
    ['ssh', ['-F', '/tmp/evilconfig', 'host']],
    // Batch A6: attached -F form.
    ['ssh', ['-F/tmp/evilconfig', 'host']],
    ['scp', ['-S', '/tmp/evil', 'a', 'host:/tmp/']],
    // Batch A6: attached -S form.
    ['scp', ['-S/tmp/evil', 'a', 'host:/tmp/']],
    ['scp', ['-o', 'LocalCommand=id', 'a', 'host:/tmp/']],
    ['docker', ['run', '--privileged', '-v', '/:/host', 'alpine']],
    ['docker', ['exec', 'abc', 'sh']],
    ['docker', ['compose', 'up']],
    // Batch A2: docker global value flags masking the subcommand.
    ['docker', ['--tlskey', 'images', 'run', '--privileged', 'alpine', 'sh']],
    ['docker', ['--tlscert', 'ps', 'run', 'alpine', 'sh']],
    ['docker', ['--tlskey=/path', 'run', 'alpine']],
    ['helm', ['upgrade', '--install', '--post-renderer', '/tmp/evil', 'rel', 'chart']],
    ['kubectl', ['--server', 'https://evil.example', 'get', 'pods']],
    ['kubectl', ['exec', 'pod', '--', 'sh']],
    ['kubectl', ['cp', 'pod:/etc/passwd', '/tmp/passwd']],
    // Batch A2: kubectl value flags masking the subcommand.
    ['kubectl', ['-n', 'foo', 'exec', 'pod', '--', 'sh']],
    ['kubectl', ['--kubeconfig', '/tmp/k', 'exec', 'pod', '--', 'sh']],
    ['kubectl', ['-n', 'kube-system', 'cp', 'pod:/etc/passwd', '/tmp/x']],
    ['kubectl', ['-n', 'default', 'port-forward', 'pod', '8080:80']],
    ['kubectl', ['--namespace=foo', 'exec', 'pod', '--', 'sh']],
    ['kubectl', ['--', 'exec', 'pod', '--', 'sh']],
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
    // Batch A2 controls: value flags before an allowed subcommand, and
    // value flags after the subcommand, must still pass.
    ['docker', ['ps']],
    ['docker', ['--tlskey', '/path', 'images']],
    ['docker', ['--config', '/tmp/docker', 'ps']],
    ['helm', ['list', '-A']],
    ['kubectl', ['get', 'pods', '-A']],
    ['kubectl', ['rollout', 'status', 'deployment/x', '-n', 'default']],
    ['kubectl', ['get', 'pods', '-n', 'foo']],
    ['kubectl', ['-n', 'foo', 'get', 'pods']],
    ['kubectl', ['--kubeconfig', '/tmp/k', 'get', 'pods']],
    ['kubectl', ['logs', 'pod', '--tail', '5']],
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

describe('token redaction and task principal (bug-hunt Batch A5)', () => {
  async function waitFor(fn: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  it('redacts --token values from the Executing log line and the persisted record', async () => {
    const pm = new ProcessManager();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-redact-'));
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-redact-bin-'));
    try {
      // Silent kubectl stub: prints nothing, so the only place the token
      // could appear in the logs is the Executing line itself. (A real
      // echo would print its args to stdout, which is the child's own
      // output, not a recorded argv surface.)
      fs.writeFileSync(path.join(binDir, 'kubectl'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
      const task = pm.runCommand('kubectl', ['--token', 'SECRET-ABC-123', 'get', 'pods'], {
        cwd: workDir,
        env: { PATH: `${binDir}:${process.env.PATH ?? ''}` },
      });
      await waitFor(() => task.status !== 'running', 5000, 'kubectl task to finish');
      const line = task.logs.find((l) => l.message.startsWith('Executing:'));
      assert.ok(line, 'expected an Executing log line');
      assert.match(line.message, /--token \[redacted\]/);
      assert.equal(line.message.includes('SECRET-ABC-123'), false, 'log line must not carry the token');
      // The persisted record (label + meta.args + logTail) is what the
      // tasks API serves, so it must be redacted too.
      const record = taskToRecord(task);
      assert.equal(record.label.includes('SECRET-ABC-123'), false, 'record label must not carry the token');
      assert.match(record.label, /--token \[redacted\]/);
      assert.deepEqual(record.meta.args, ['--token', '[redacted]', 'get', 'pods']);
      assert.equal(
        (record.logTail as Array<{ message: string }>).some((l) => l.message.includes('SECRET-ABC-123')),
        false,
        'stored log must not carry the token'
      );
      // The spawn itself still used the real args: task.args is untouched.
      assert.deepEqual(task.args, ['--token', 'SECRET-ABC-123', 'get', 'pods']);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('redacts the --token=value form', async () => {
    const pm = new ProcessManager();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-redact-eq-'));
    try {
      const task = pm.runCommand('echo', ['--token=SECRET-DEF-456'], { cwd: workDir });
      await waitFor(() => task.status !== 'running', 5000, 'echo task to finish');
      const line = task.logs.find((l) => l.message.startsWith('Executing:'));
      assert.ok(line, 'expected an Executing log line');
      assert.match(line.message, /--token=\[redacted\]/);
      assert.equal(line.message.includes('SECRET-DEF-456'), false);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('records the launching principal on the task and through the store', async () => {
    const pm = new ProcessManager();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-principal-'));
    try {
      const task = pm.runCommand('echo', ['hi'], { cwd: workDir, principalId: 'p_view' });
      assert.equal(task.principalId, 'p_view');
      await waitFor(() => task.status !== 'running', 5000, 'echo task to finish');
      const store = new TaskStore(path.join(workDir, 'state.db'));
      try {
        store.upsert(taskToRecord(task));
        const row = store.get(task.id);
        assert.ok(row, 'expected a stored row');
        assert.equal((row.meta as { principalId?: unknown }).principalId, 'p_view');
      } finally {
        store.close();
      }
      // No principal given: a system task, visible to all tasks:read holders.
      const system = pm.runCommand('echo', ['hi'], { cwd: workDir });
      assert.equal(system.principalId, null);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('runCommandAndWait + input + persist (Plan III Q8)', () => {
  let binDir: string;
  let workDir: string;

  before(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-q8-bin-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-q8-work-'));
    // kubectl stub: `apply -f -` cats stdin back out (the stdin path
    // under test); `failer` exits 1 with stderr; anything else prints
    // two pod lines and exits 0.
    fs.writeFileSync(
      path.join(binDir, 'kubectl'),
      '#!/bin/bash\nif [ "$1" = "apply" ]; then cat; exit 0; fi\nif [ "$1" = "failer" ]; then echo boom >&2; exit 1; fi\necho pod-a\necho pod-b\nexit 0\n',
      { mode: 0o755 }
    );
  });

  after(() => {
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const env = () => ({ PATH: `${binDir}:${process.env.PATH ?? ''}` });

  it('resolves with code, status and captured stdout/stderr/logs on success', async () => {
    const pm = new ProcessManager();
    const result = await pm.runCommandAndWait('kubectl', ['get', 'pods'], {
      cwd: workDir,
      env: env(),
    });
    assert.equal(result.code, 0);
    assert.equal(result.status, 'completed');
    assert.equal(result.stdout, 'pod-a\npod-b\n');
    assert.equal(result.stderr, '');
    assert.ok(result.taskId.startsWith('task_'));
    assert.ok(result.logs.some((l) => l.type === 'stdout' && l.message.includes('pod-a')));
    assert.ok(result.logs.some((l) => l.type === 'system' && l.message.startsWith('Executing:')));
  });

  it('resolves (does not reject) on a non-zero exit, with stderr captured', async () => {
    const pm = new ProcessManager();
    const result = await pm.runCommandAndWait('kubectl', ['failer'], {
      cwd: workDir,
      env: env(),
    });
    assert.equal(result.code, 1);
    assert.equal(result.status, 'failed');
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /boom/);
    assert.throws(() => assertCommandSuccess(result, 'kubectl failer'), /kubectl failer failed \(exit code 1\): boom/);
  });

  it('assertCommandSuccess is a no-op on exit 0', async () => {
    const pm = new ProcessManager();
    const result = await pm.runCommandAndWait('echo', ['hi'], { cwd: workDir });
    assert.equal(result.code, 0);
    assert.doesNotThrow(() => assertCommandSuccess(result, 'echo hi'));
  });

  it('pipes input to stdin (kubectl apply -f -)', async () => {
    const pm = new ProcessManager();
    const manifest = 'apiVersion: v1\nkind: ConfigMap\n';
    const result = await pm.runCommandAndWait('kubectl', ['apply', '-f', '-'], {
      cwd: workDir,
      env: env(),
      input: manifest,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, manifest);
  });

  it('streams log entries to onLog as they land', async () => {
    const pm = new ProcessManager();
    const seen: string[] = [];
    const result = await pm.runCommandAndWait('echo', ['hello-onlog'], {
      cwd: workDir,
      onLog: (entry) => seen.push(`${entry.type}:${entry.message}`),
    });
    assert.equal(result.code, 0);
    assert.ok(seen.some((s) => s.startsWith('stdout:') && s.includes('hello-onlog')));
    assert.ok(seen.some((s) => s.startsWith('system:Executing:')));
  });

  it('rejects when the validator refuses the command', async () => {
    const pm = new ProcessManager();
    await assert.rejects(
      pm.runCommandAndWait('kubectl', ['exec', 'pod', '--', 'sh'], { cwd: workDir, env: env() }),
      /allowlist/
    );
  });

  it('persist: false keeps the task out of the attached store', async () => {
    const pm = new ProcessManager();
    const store = new TaskStore(path.join(workDir, 'state.db'));
    try {
      pm.attachStore(store);
      const kept = await pm.runCommandAndWait('echo', ['hi'], { cwd: workDir });
      assert.equal(kept.status, 'completed');
      assert.ok(store.get(kept.taskId), 'default run is persisted');
      const skipped = await pm.runCommandAndWait('echo', ['hi'], { cwd: workDir, persist: false });
      assert.equal(skipped.status, 'completed');
      // TaskStore.get returns null for a missing row.
      assert.equal(store.get(skipped.taskId), null, 'persist:false run must not reach the store');
      // The non-persisted task still exists in memory with its logs.
      assert.equal(pm.getTask(skipped.taskId)?.status, 'completed');
    } finally {
      store.close();
    }
  });

  it('validator accepts every new Q8 call shape', () => {
    const repoRoot = path.resolve(process.cwd(), '..', '..');
    const storageScript = path.join(repoRoot, 'src', 'k3s_storage.sh');
    assert.ok(fs.existsSync(storageScript), `expected project script at ${storageScript}`);
    const allowed: Array<[string, string[], string]> = [
      // runner.ts preflight + step deploy
      ['helm', ['upgrade', '--install', 'openebs', '/charts/openebs', '--namespace', 'openebs', '--create-namespace', '--wait', '--timeout', '5m'], process.cwd()],
      ['helm', ['upgrade', '--install', 'rel', 'chart', '--namespace', 'ns', '--create-namespace', '--wait', '--timeout', '5m', '--take-ownership', '--set', 'ingress.host=example.com', '--set', 'replicas=3', '--dry-run'], process.cwd()],
      ['bash', [storageScript, 'install', '--engine', 'openebs'], repoRoot],
      // watcher.ts poll loop + rollout
      ['git', ['fetch', '--depth', '1'], process.cwd()],
      ['git', ['status', '--porcelain'], process.cwd()],
      ['git', ['rev-parse', 'HEAD'], process.cwd()],
      ['helm', ['dependency', 'update', './ecosystem'], process.cwd()],
      ['kubectl', ['get', 'deployments', '-n', 'ns', '-o', 'jsonpath={.items[*].metadata.name}'], process.cwd()],
      ['kubectl', ['rollout', 'restart', 'deployment/web', '-n', 'ns'], process.cwd()],
      ['kubectl', ['rollout', 'status', 'deployment/web', '-n', 'ns', '--timeout=90s'], process.cwd()],
      // health.ts
      ['kubectl', ['rollout', 'status', 'deployment/web', '-n', 'ns', '--timeout=60s'], process.cwd()],
      ['kubectl', ['get', 'sc', 'openebs-hostpath'], process.cwd()],
      ['kubectl', ['wait', '--for=condition=ready', 'pod', '-l', 'app.kubernetes.io/instance=rel', '-n', 'ns', '--timeout=2m'], process.cwd()],
      // images.ts git/docker/kubectl
      ['git', ['clone', '-b', 'main', '--depth', '1', '--', 'https://example.com/repo.git', '/tmp/x'], process.cwd()],
      ['git', ['-C', '/tmp/x', 'fetch', '--tags'], process.cwd()],
      ['git', ['-C', '/tmp/x', 'checkout', 'abc123'], process.cwd()],
      ['git', ['-C', '/tmp/x', 'pull', 'origin', 'main'], process.cwd()],
      ['docker', ['build', '-t', 'img:tag', '-f', '/tmp/Dockerfile', '/tmp/ctx'], process.cwd()],
      ['docker', ['push', '--tls-verify=false', 'img:tag'], process.cwd()],
      ['docker', ['push', 'img:tag'], process.cwd()],
      ['docker', ['tag', 'img:tag', 'other:tag'], process.cwd()],
      ['kubectl', ['apply', '-f', '-'], process.cwd()],
      ['kubectl', ['rollout', 'status', 'deployment/registry', '-n', 'registry', '--timeout=120s'], process.cwd()],
      ['kubectl', ['get', 'nodes', '-o', 'jsonpath={.items[*].metadata.name}'], process.cwd()],
      // secrets.ts
      ['kubectl', ['create', 'namespace', 'ns', '--dry-run=client', '-o', 'yaml'], process.cwd()],
      // helm.ts / metrics.ts
      ['helm', ['list', '-A', '-o', 'json'], process.cwd()],
      ['kubectl', ['top', 'pods', '-A', '--no-headers'], process.cwd()],
      ['kubectl', ['top', 'nodes', '--no-headers'], process.cwd()],
    ];
    for (const [binary, args, cwd] of allowed) {
      const result = validateCommand(binary, args, cwd);
      assert.equal(result.allowed, true, `${binary} ${args.join(' ')}: ${result.reason ?? 'ok'}`);
    }
    // Negative controls: the validator must still refuse these.
    assert.equal(validateCommand('kubectl', ['exec', 'pod', '--', 'sh']).allowed, false);
    assert.equal(
      validateCommand('helm', ['upgrade', '--install', '--post-renderer', '/tmp/x', 'r', 'c']).allowed,
      false
    );
    assert.equal(validateCommand('curl', ['-fsS', 'http://localhost:5001/v2/']).allowed, false);
  });
});
