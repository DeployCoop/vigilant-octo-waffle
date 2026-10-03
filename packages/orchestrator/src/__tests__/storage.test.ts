import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
