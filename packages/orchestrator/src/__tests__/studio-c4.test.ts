import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireFound } from '../studio-store.js';
import { executeSyntheticLoad } from '../keda.js';
import { calculateBurnRates } from '../slo.js';
import { deployWasmMicroservice } from '../wasm.js';
import { compareSnapshotWithLive } from '../rewind.js';
import { broadcastApplication } from '../fleet.js';

/** Batch C, C4: unknown ids are misses, never store[0] fallbacks. */

describe('requireFound', () => {
  it('returns the match and null on a miss (never the first entry)', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(requireFound(items, (x) => x.id === 'b'), { id: 'b' });
    assert.equal(requireFound(items, (x) => x.id === 'nope'), null);
    assert.equal(requireFound([], () => true), null);
  });
});

describe('studio store[0] fallbacks (C4)', () => {
  it('keda: unknown workload returns null instead of running against nextcloud-worker', async () => {
    const result = await executeSyntheticLoad({
      targetWorkload: 'no-such-workload',
      virtualUsers: 20,
      durationSeconds: 5,
      targetRps: 250,
      pattern: 'SPIKE',
    });
    assert.equal(result, null);
  });

  it('keda: known workload still runs', async () => {
    const result = await executeSyntheticLoad({
      targetWorkload: 'nextcloud-worker',
      virtualUsers: 20,
      durationSeconds: 5,
      targetRps: 250,
      pattern: 'SPIKE',
    });
    assert.ok(result);
    assert.equal(result.targetWorkload, 'nextcloud-worker');
  });

  it('slo: unknown service returns null instead of keycloak burn rates', async () => {
    assert.equal(await calculateBurnRates('no-such-service'), null);
    const known = await calculateBurnRates('slo-keycloak');
    assert.ok(known);
    assert.equal(known.serviceId, 'slo-keycloak');
  });

  it('wasm: unknown service returns success:false with an empty manifest', async () => {
    const result = await deployWasmMicroservice('no-such-service', 'default');
    assert.equal(result.success, false);
    assert.equal(result.manifest, '');
    assert.match(result.message, /not found/);
    const known = await deployWasmMicroservice('wasm-rust-kv', 'default');
    assert.equal(known.success, true);
    assert.ok(known.manifest.length > 0);
  });

  it('rewind: unknown snapshot returns null instead of comparing against the first snapshot', async () => {
    assert.equal(await compareSnapshotWithLive('no-such-snapshot'), null);
    const known = await compareSnapshotWithLive('snap-2026-09-28-1800');
    assert.ok(known);
    assert.equal(known.snapshotId, 'snap-2026-09-28-1800');
    assert.ok(known.deltas.length > 0);
  });

  it('fleet: broadcasting to zero matching clusters returns success:false', async () => {
    const result = await broadcastApplication('my-app', ['no-such-cluster']);
    assert.equal(result.success, false);
    assert.deepEqual(result.deployedClusters, []);
    const known = await broadcastApplication('my-app', ['cluster-kind-local']);
    assert.equal(known.success, true);
    assert.equal(known.deployedClusters.length, 1);
  });
});
