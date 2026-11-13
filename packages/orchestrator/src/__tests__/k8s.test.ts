/**
 * Regression tests for the telemetry probe cache (studio wiring,
 * Phase 0, F1): `getTelemetry()` is the `isConnected` probe every
 * wired studio calls per request. A short-TTL module-level cache
 * (shared across the per-request `K8sClient` instances) must serve
 * repeat probes without re-issuing the four list calls, expire, and
 * stay keyed by kubeconfig context.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { K8sClient, clearTelemetryCache } from '../k8s.js';

interface CallCounts {
  nodes: number;
  pods: number;
  namespaces: number;
  ingresses: number;
}

function counted(): CallCounts {
  return { nodes: 0, pods: 0, namespaces: 0, ingresses: 0 };
}

const NODE = {
  metadata: {
    name: 'node-1',
    labels: {},
    creationTimestamp: new Date('2026-01-01T00:00:00Z'),
  },
  status: {
    conditions: [{ type: 'Ready', status: 'True' }],
    nodeInfo: { osImage: 'Ubuntu 24.04', kubeletVersion: 'v1.30.0' },
  },
};

// The sandbox has no kubeconfig, so the constructor leaves the API
// clients unset; inject counting stubs via the standard private-access
// workaround (the same pattern waffle.test.ts uses for private methods).
function stubbedClient(context: string, counts: CallCounts, fail = false): K8sClient {
  const client = new K8sClient();
  const maybeFail = async <T>(items: T[]): Promise<{ items: T[] }> => {
    if (fail) throw new Error('api down');
    return { items };
  };
  const apis = {
    listNode: async () => {
      counts.nodes++;
      return maybeFail([NODE]);
    },
    listPodForAllNamespaces: async () => {
      counts.pods++;
      return maybeFail([]);
    },
    listNamespace: async () => {
      counts.namespaces++;
      return maybeFail([]);
    },
    listIngressForAllNamespaces: async () => {
      counts.ingresses++;
      return maybeFail([]);
    },
  };
  (client as unknown as { coreApi: unknown }).coreApi = apis;
  (client as unknown as { netApi: unknown }).netApi = apis;
  (client as unknown as { kc: { currentContext: string } }).kc.currentContext = context;
  return client;
}

describe('getTelemetry offline semantics', { concurrency: 1 }, () => {
  it('reports isConnected:false with empty lists when the cluster is down', async () => {
    clearTelemetryCache();
    // This sandbox has a kubeconfig (context 'loaded-context') but no
    // reachable cluster: the four list calls fail fast, the probe
    // returns the offline shape, and the failure is cached under that
    // context. The context is whatever the kubeconfig reports — the
    // assertion pins that it is reported, not a specific sandbox value.
    const client = new K8sClient();
    const t = await client.getTelemetry();
    assert.equal(t.isConnected, false);
    assert.equal(
      t.context,
      (client as unknown as { kc: { currentContext: string } }).kc.currentContext
    );
    assert.equal(t.nodeCount, 0);
    assert.equal(t.podCount, 0);
    assert.equal(t.namespaceCount, 0);
    assert.equal(t.ingressCount, 0);
    assert.deepEqual(t.nodes, []);
    assert.deepEqual(t.namespaces, []);
    assert.deepEqual(t.ingresses, []);
  });
});

// The cache is module-level shared state, and node:test runs tests in a
// file concurrently by default — the cache tests must run sequentially
// or they clear/repopulate the single entry under each other.
describe('getTelemetry cache (Phase 0, F1)', { concurrency: 1 }, () => {
  it('serves the second probe from cache without new list calls', async () => {
    clearTelemetryCache();
    const counts = counted();
    const client = stubbedClient('cache-hit', counts);
    const first = await client.getTelemetry();
    assert.equal(first.isConnected, true);
    assert.equal(first.nodeCount, 1);
    assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });

    const second = await client.getTelemetry();
    assert.deepEqual(second, first);
    // A copy, not the cached object itself: mutating the returned
    // telemetry must not corrupt the shared entry.
    assert.notEqual(second, first);
    assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });
  });

  it('expires after the TTL and refetches', async (t) => {
    clearTelemetryCache();
    const counts = counted();
    const client = stubbedClient('cache-expiry', counts);
    // The mocked clock starts at 0, unrelated to real time, so the
    // clock must be mocked BEFORE the first probe: otherwise the entry
    // is stamped with a real timestamp and the mocked Date.now() is
    // always earlier than it, so the entry never looks expired.
    t.mock.timers.enable({ apis: ['Date'] });
    try {
      await client.getTelemetry();
      assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });
      // Within the TTL the probe is still served from cache.
      t.mock.timers.tick(5_000);
      await client.getTelemetry();
      assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });
      // Past the TTL it refetches.
      t.mock.timers.tick(6_000);
      await client.getTelemetry();
      assert.deepEqual(counts, { nodes: 2, pods: 2, namespaces: 2, ingresses: 2 });
    } finally {
      t.mock.timers.reset();
    }
  });

  it('is keyed by kubeconfig context', async () => {
    clearTelemetryCache();
    const counts = counted();
    const a = stubbedClient('ctx-a', counts);
    const b = stubbedClient('ctx-b', counts);
    await a.getTelemetry();
    assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });
    // A different context must not be served from a's entry.
    await b.getTelemetry();
    assert.deepEqual(counts, { nodes: 2, pods: 2, namespaces: 2, ingresses: 2 });
    // a's entry is still valid within the TTL.
    await a.getTelemetry();
    assert.deepEqual(counts, { nodes: 2, pods: 2, namespaces: 2, ingresses: 2 });
  });

  it('caches the failure result under the same bound', async () => {
    clearTelemetryCache();
    const counts = counted();
    const client = stubbedClient('cache-failure', counts, true);
    const first = await client.getTelemetry();
    assert.equal(first.isConnected, false);
    assert.equal(first.nodeCount, 0);
    assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });
    await client.getTelemetry();
    assert.deepEqual(counts, { nodes: 1, pods: 1, namespaces: 1, ingresses: 1 });
  });
});
