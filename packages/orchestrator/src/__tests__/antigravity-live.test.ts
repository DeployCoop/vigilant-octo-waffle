import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAntigravityEngineStatus,
  askAntigravity,
  streamAntigravity,
  runClusterWatchdogScan,
  findProjectRoot,
} from '../index.js';

/**
 * Live-provider Antigravity tests — OPT-IN, never part of the
 * default suite (Plan III §5.2).
 *
 * These tests call the real engine: getAntigravityEngineStatus
 * probes for the `agy` binary, askAntigravity / streamAntigravity
 * query the configured Ollama / vLLM endpoints, and
 * runClusterWatchdogScan delegates 1:1 to askAntigravity. Without
 * a live provider the engine answers from its built-in heuristic
 * fallback (engineUsed: cluster-copilot-engine), which is why the
 * old copies of these tests in smoke.test.ts passed either way.
 * Behind the gate the assertions require a live engine to answer.
 *
 * Run with a local provider up:
 *   VOW_LIVE_PROVIDERS=1 node --test dist/__tests__/antigravity-live.test.js
 *
 * This mirrors the opt-in philosophy of parity's
 * VOW_PARITY_REQUIRED gating (see helpers.ts), inverted: parity
 * must run in CI, these must not — CI has no providers.
 */
const LIVE_PROVIDERS = process.env.VOW_LIVE_PROVIDERS === '1';
const SKIP_REASON =
  'opt-in: set VOW_LIVE_PROVIDERS=1 with a local provider (agy, Ollama, or vLLM) running';

// Gate per test, not per describe: node:test reports per-it skips in
// the suite totals, while a describe-level skip hides the tests from
// the counts entirely.
const testLive = (name: string, fn: () => Promise<void>) =>
  it(name, { skip: LIVE_PROVIDERS ? false : SKIP_REASON }, fn);

describe('Antigravity Live Provider Integration', () => {
  const projectRoot = findProjectRoot();

  testLive('detects Antigravity CLI binary and returns engine status with Ollama and vLLM providers', async () => {
    const status = await getAntigravityEngineStatus();
    assert.ok(typeof status.available === 'boolean');
    assert.ok(status.defaultModel.includes('gemini'));
    assert.ok(status.availableModels.length > 0);
    assert.ok(status.availableModels.includes('gemini-3.8-flash-high'));
    assert.ok(status.providers.antigravity);
    assert.ok(status.providers.ollama);
    assert.ok(status.providers.vllm);
    assert.ok(status.providers.ollama.models.length > 0);
    assert.ok(status.providers.vllm.models.length > 0);
    // Behind the opt-in gate the operator asserts a provider is live:
    // at least one provider must actually report itself available.
    assert.ok(
      status.providers.antigravity.available ||
        status.providers.ollama.available ||
        status.providers.vllm.available,
      'VOW_LIVE_PROVIDERS=1 but no provider reports available'
    );
  });

  testLive('answers cluster questions with structured response and snapshot', async () => {
    const result = await askAntigravity({
      prompt: 'What is the status of the cluster?',
      includeClusterContext: true,
      root: projectRoot,
    });

    assert.ok(result);
    assert.ok(result.response && result.response.length > 0);
    // Behind the gate, a live engine must answer — the heuristic
    // fallback (cluster-copilot-engine) means no provider was reached.
    assert.notEqual(
      result.engineUsed,
      'cluster-copilot-engine',
      'VOW_LIVE_PROVIDERS=1 but the heuristic fallback answered'
    );
    assert.ok(result.clusterSnapshot);
    assert.ok(typeof result.clusterSnapshot.nodeCount === 'number');
  });

  testLive('handles Ollama provider query against the live provider', async () => {
    const result = await askAntigravity({
      prompt: 'What pods are in namespace default?',
      provider: 'ollama',
      model: 'llama3:latest',
      includeClusterContext: true,
      root: projectRoot,
    });

    assert.ok(result);
    assert.equal(result.provider, 'ollama');
    assert.equal(result.modelUsed, 'llama3:latest');
    assert.ok(result.response && result.response.length > 0);
    // Behind the gate the requested provider itself must answer.
    assert.equal(result.engineUsed, 'ollama');
  });

  testLive('handles vLLM provider query against the live provider', async () => {
    const result = await askAntigravity({
      prompt: 'How to inspect certificates in cluster?',
      provider: 'vllm',
      model: 'meta-llama/Meta-Llama-3-8B-Instruct',
      includeClusterContext: true,
      root: projectRoot,
    });

    assert.ok(result);
    assert.equal(result.provider, 'vllm');
    assert.equal(result.modelUsed, 'meta-llama/Meta-Llama-3-8B-Instruct');
    assert.ok(result.response && result.response.length > 0);
    // Behind the gate the requested provider itself must answer.
    assert.equal(result.engineUsed, 'vllm');
  });

  testLive('streams real-time events and incremental chunks with streamAntigravity', async () => {
    const events: any[] = [];
    const result = await streamAntigravity(
      {
        prompt: 'What is the cluster status?',
        includeClusterContext: true,
        root: projectRoot,
      },
      (event) => {
        events.push(event);
      }
    );

    assert.ok(result);
    assert.ok(events.length > 0);
    assert.ok(events.some((e) => e.type === 'status'));
    assert.ok(events.some((e) => e.type === 'chunk'));
    assert.ok(
      events.some((e) => e.type === 'chunk' && (e.text ?? '').length > 0),
      'expected at least one streamed chunk carrying content'
    );
    assert.ok(events.some((e) => e.type === 'done'));
    const doneEvt = events.find((e) => e.type === 'done');
    assert.ok(doneEvt.response);
    assert.equal(doneEvt.response.response, result.response);
    // Behind the gate the stream must come from a live engine too.
    assert.notEqual(
      doneEvt.response.engineUsed,
      'cluster-copilot-engine',
      'VOW_LIVE_PROVIDERS=1 but the heuristic fallback answered'
    );
  });

  testLive('executes runClusterWatchdogScan to produce deep health analysis', async () => {
    const watchdog = await runClusterWatchdogScan(projectRoot, { effort: 'low' });
    assert.ok(watchdog);
    assert.ok(watchdog.response.length > 0);
    // The watchdog delegates to askAntigravity; behind the gate its
    // answer must come from a live engine, not the heuristic fallback.
    assert.notEqual(
      watchdog.engineUsed,
      'cluster-copilot-engine',
      'VOW_LIVE_PROVIDERS=1 but the heuristic fallback answered'
    );
    assert.ok(watchdog.clusterSnapshot);
  });
});
