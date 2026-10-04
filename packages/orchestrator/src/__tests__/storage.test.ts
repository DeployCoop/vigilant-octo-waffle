import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateStorageHostPrereqs,
  detectHostVolumeGroups,
  checkOpenEbsStatus,
  isOpenEbsInstalledAndReady,
  deployOpenEBS,
} from '../storage.js';
import { findProjectRoot } from '../config.js';

describe('Storage Fabric Engine', () => {
  const projectRoot = findProjectRoot();

  // Hermetic kubectl stub: reports a healthy OpenEBS install (storage class,
  // ready provisioner deployment, running pod) so the status/deploy logic can
  // be exercised without a live cluster. Scoped to this test process only.
  let stubDir = '';
  let originalPath = '';
  before(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-kubectl-stub-'));
    const stub = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"get sc"*) echo \'{"items":[{"metadata":{"name":"openebs-hostpath"},"provisioner":"openebs.io/local"}]}\' ;;',
      '  *"get deployment"*) echo \'{"items":[{"metadata":{"name":"openebs-localpv-provisioner"},"status":{"readyReplicas":1,"replicas":1}}]}\' ;;',
      '  *"get pods"*) echo "openebs-localpv-provisioner-abc 1/1 Running 0 1h" ;;',
      "  *) echo '{}' ;;",
      'esac',
      'exit 0',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(stubDir, 'kubectl'), stub, { mode: 0o755 });
    originalPath = process.env.PATH || '';
    process.env.PATH = `${stubDir}${path.delimiter}${originalPath}`;
  });
  after(() => {
    process.env.PATH = originalPath;
    if (stubDir) fs.rmSync(stubDir, { recursive: true, force: true });
  });

  it('validates host prerequisites without crashing', async () => {
    const prereqs = await validateStorageHostPrereqs();
    assert.ok(Array.isArray(prereqs));
    assert.ok(prereqs.length >= 3);
    for (const p of prereqs) {
      assert.ok(p.name);
      assert.ok(p.message);
      assert.strictEqual(typeof p.passed, 'boolean');
    }
  });

  it('detects host volume groups safely', async () => {
    const vgs = await detectHostVolumeGroups();
    assert.ok(Array.isArray(vgs));
  });

  it('detects OpenEBS cluster readiness and storage classes', async () => {
    const status = await checkOpenEbsStatus(projectRoot);
    assert.ok(status);
    assert.strictEqual(typeof status.isReady, 'boolean');
    assert.ok(Array.isArray(status.storageClasses));
    assert.ok(Array.isArray(status.readyDeployments));
    assert.strictEqual(typeof status.runningPods, 'number');
    assert.ok(status.message);

    const isReady = await isOpenEbsInstalledAndReady(projectRoot);
    assert.strictEqual(isReady, status.isReady);
  });

  it('skips redundant Helm upgrade when OpenEBS is already active', async () => {
    const res = await deployOpenEBS(projectRoot);
    assert.ok(res);
    assert.strictEqual(typeof res.success, 'boolean');
    assert.strictEqual(res.success, true);
    assert.ok(res.output.includes('already installed') || res.output.length > 0);
  });
});
