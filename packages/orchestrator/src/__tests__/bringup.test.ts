import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClusterBringUpEngine, createBringUpEngine } from '../bringup.js';

describe('Cluster BringUp Engine (TypeScript Native)', () => {
  it('instantiates bringup engine with default options', () => {
    const engine = createBringUpEngine(process.cwd());
    assert.ok(engine instanceof ClusterBringUpEngine);
  });

  it('executes full bring-up in dry-run mode and emits progress events', async () => {
    const engine = createBringUpEngine(process.cwd());
    const events: any[] = [];

    engine.on('progress', (p) => {
      events.push({ status: p.status, step: p.currentStepId, index: p.currentStepIndex });
    });

    const result = await engine.execute({ dryRun: true });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.steps.length, 10);
    assert.ok(result.steps.every((s) => s.status === 'completed'));
    assert.ok(events.length > 5);
  });

  it('allows abortion during execution', async () => {
    const engine = createBringUpEngine(process.cwd());
    engine.abort();
    const result = await engine.execute({ dryRun: true });
    assert.strictEqual(result.status, 'failed');
    assert.ok(result.error?.includes('aborted'));
  });
});
