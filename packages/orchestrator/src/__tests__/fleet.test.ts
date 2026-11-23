/**
 * Fleet commander wired to real systems (studio wiring, Phase 1).
 *
 * The K8s layer is stubbed at the `FleetK8sClient` seam (the F3 ebpf
 * precedent): the stub models a kubeconfig with scripted contexts,
 * telemetry, and Argo state, and records every context switch. The
 * assertions pin the mapping from those real-shaped inputs to fleet
 * records — counts, versions, capacity, provider/environment
 * derivation, ONLINE/DEGRADED/OFFLINE, sync status, switch
 * verification, per-cluster broadcast aggregation, and context
 * restoration. No assertion depends on a fabricated fleet record: every
 * expected value is either the stub's own scripted telemetry or a
 * derivation documented in fleet.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClusterUnavailableError } from '../errors.js';
import {
  listFleetClusters,
  switchClusterContext,
  broadcastApplication,
  type FleetK8sClient,
  type FleetDeps,
} from '../fleet.js';
import type { ArgoAppStatus, ClusterTelemetry } from '../k8s.js';
import type { CommandWaitResult } from '../executor.js';

interface StubContextState {
  telemetry: ClusterTelemetry;
  argo: { installed: boolean; applications: ArgoAppStatus[] };
}

function telemetry(overrides: Partial<ClusterTelemetry> & { context: string }): ClusterTelemetry {
  return {
    isConnected: true,
    detectedPlatform: 'unknown',
    detectedClusterName: '',
    nodeCount: 1,
    podCount: 5,
    namespaceCount: 3,
    ingressCount: 0,
    nodes: [
      { name: 'node-1', status: 'Ready', roles: ['control-plane'], age: '', osImage: 'Ubuntu 24.04' },
    ],
    namespaces: ['default'],
    ingresses: [],
    k8sVersion: 'v1.31.2',
    cpuCapacityCores: 8,
    memoryCapacityGb: 16,
    server: 'https://127.0.0.1:6443',
    ...overrides,
  };
}

function argoApp(name: string, syncStatus: ArgoAppStatus['syncStatus']): ArgoAppStatus {
  return { name, namespace: 'argocd', healthStatus: 'Healthy', syncStatus };
}

/** Kubeconfig model: scripted contexts + telemetry + Argo state, with a switch log. */
class StubClient implements FleetK8sClient {
  public switches: string[] = [];
  private current: string;

  constructor(
    private readonly contexts: string[],
    current: string,
    private readonly states: Record<string, StubContextState>
  ) {
    this.current = current;
  }

  getContexts(): { current: string; contexts: string[] } {
    return { current: this.current, contexts: [...this.contexts] };
  }

  async withContext<T>(
    contextName: string,
    fn: (client: FleetK8sClient) => Promise<T>
  ): Promise<T> {
    if (!this.contexts.includes(contextName)) {
      throw new Error(`Kubernetes context '${contextName}' not found in kubeconfig`);
    }
    const previous = this.current;
    this.current = contextName;
    try {
      return await fn(this);
    } finally {
      this.current = previous;
    }
  }

  async getTelemetry(): Promise<ClusterTelemetry> {
    const state = this.states[this.current];
    if (!state) {
      return telemetry({ context: this.current, isConnected: false, nodeCount: 0, podCount: 0 });
    }
    return state.telemetry;
  }

  async getArgoApplications(): Promise<{ installed: boolean; applications: ArgoAppStatus[] }> {
    return this.states[this.current]?.argo ?? { installed: false, applications: [] };
  }

  async switchContext(contextName: string): Promise<void> {
    if (!this.contexts.includes(contextName)) {
      throw new Error(`kubectl: context '${contextName}' not found`);
    }
    this.switches.push(contextName);
    this.current = contextName;
  }
}

function threeClusterClient(): { client: StubClient; deps: FleetDeps } {
  const client = new StubClient(
    ['kind-local', 'k3d-edge', 'arn:aws:eks:us-east-1:123456789012:cluster/prod-eks'],
    'kind-local',
    {
      'kind-local': {
        telemetry: telemetry({
          context: 'kind-local',
          detectedPlatform: 'kind',
          detectedClusterName: 'local',
          nodeCount: 1,
          podCount: 24,
          k8sVersion: 'v1.31.2',
          cpuCapacityCores: 8,
          memoryCapacityGb: 16,
          server: 'https://127.0.0.1:6443',
        }),
        argo: { installed: true, applications: [argoApp('nextcloud', 'Synced')] },
      },
      'k3d-edge': {
        telemetry: telemetry({
          context: 'k3d-edge',
          detectedPlatform: 'k3d',
          detectedClusterName: 'edge',
          nodeCount: 3,
          podCount: 18,
          k8sVersion: 'v1.30.4+k3s1',
          cpuCapacityCores: 12,
          memoryCapacityGb: 24,
          server: 'https://10.46.48.100:6443',
          nodes: [
            { name: 'k3d-edge-server-0', status: 'Ready', roles: ['server'], age: '', osImage: 'K3s' },
            { name: 'k3d-edge-agent-0', status: 'NotReady', roles: ['agent'], age: '', osImage: 'K3s' },
            { name: 'k3d-edge-agent-1', status: 'Ready', roles: ['agent'], age: '', osImage: 'K3s' },
          ],
        }),
        argo: { installed: true, applications: [argoApp('keycloak', 'OutOfSync')] },
      },
      'arn:aws:eks:us-east-1:123456789012:cluster/prod-eks': {
        telemetry: telemetry({
          context: 'arn:aws:eks:us-east-1:123456789012:cluster/prod-eks',
          detectedPlatform: 'unknown',
          detectedClusterName: 'prod-eks',
          nodeCount: 6,
          podCount: 84,
          k8sVersion: 'v1.31.0',
          cpuCapacityCores: 48,
          memoryCapacityGb: 192,
          server: 'https://ABCDEF.gr7.us-east-1.eks.amazonaws.com',
        }),
        argo: { installed: false, applications: [] },
      },
    }
  );
  return { client, deps: { client, cdRunner: 'argocd', projectRoot: '/tmp/vow-fleet-test' } };
}

function waitResult(code: number, taskId = 'task_test'): CommandWaitResult {
  return { code, status: code === 0 ? 'completed' : 'failed', logs: [], stdout: '', stderr: '', taskId };
}

describe('listFleetClusters (wired)', () => {
  it('builds one record per kubeconfig context from real telemetry', async () => {
    const { client, deps } = threeClusterClient();
    const clusters = await listFleetClusters(deps);
    assert.equal(clusters.length, 3);

    const [kind, k3d, eks] = clusters;
    assert.equal(kind.id, 'kind-local');
    assert.equal(kind.name, 'local');
    assert.equal(kind.provider, 'kind');
    assert.equal(kind.environment, 'local');
    assert.equal(kind.k8sVersion, 'v1.31.2');
    assert.equal(kind.nodeCount, 1);
    assert.equal(kind.podCount, 24);
    assert.equal(kind.cpuCapacityCores, 8);
    assert.equal(kind.memoryCapacityGb, 16);
    assert.equal(kind.location, '127.0.0.1:6443');
    assert.equal(kind.status, 'ONLINE');
    assert.equal(kind.isCurrentContext, true);
    assert.equal(kind.argocdSyncStatus, 'Synced');

    // One NotReady node degrades the cluster; an OutOfSync app shows up.
    assert.equal(k3d.provider, 'k3d');
    assert.equal(k3d.environment, 'local');
    assert.equal(k3d.nodeCount, 3);
    assert.equal(k3d.status, 'DEGRADED');
    assert.equal(k3d.isCurrentContext, false);
    assert.equal(k3d.argocdSyncStatus, 'OutOfSync');
    assert.equal(k3d.location, '10.46.48.100:6443');

    // EKS appears only because the context exists; Argo absent is Unknown, not OutOfSync.
    assert.equal(eks.provider, 'eks');
    assert.equal(eks.environment, 'production');
    assert.equal(eks.nodeCount, 6);
    assert.equal(eks.podCount, 84);
    assert.equal(eks.status, 'ONLINE');
    assert.equal(eks.argocdSyncStatus, 'Unknown');
    // URL parsing lowercases the host.
    assert.equal(eks.location, 'abcdef.gr7.us-east-1.eks.amazonaws.com');

    // Probing did not move the operator's context.
    assert.equal(client.getContexts().current, 'kind-local');
  });

  it('reports an unreachable context OFFLINE instead of failing the list', async () => {
    const { deps } = threeClusterClient();
    const client = deps.client as StubClient;
    const clusters = await listFleetClusters({
      ...deps,
      client: new StubClient(
        ['kind-local'],
        'kind-local',
        {
          'kind-local': {
            telemetry: telemetry({
              context: 'kind-local',
              isConnected: false,
              nodeCount: 0,
              podCount: 0,
              nodes: [],
              server: 'https://127.0.0.1:6443',
            }),
            argo: { installed: false, applications: [] },
          },
        }
      ),
    });
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].status, 'OFFLINE');
    assert.equal(clusters[0].nodeCount, 0);
    assert.equal(clusters[0].podCount, 0);
    assert.equal(client.getContexts().current, 'kind-local');
  });

  it('throws ClusterUnavailableError when no contexts are configured', async () => {
    const empty = new StubClient([], '', {});
    await assert.rejects(
      () => listFleetClusters({ client: empty }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });
});

describe('switchClusterContext (wired)', () => {
  it('switches via the real switch path and verifies with telemetry', async () => {
    const { client, deps } = threeClusterClient();
    const result = await switchClusterContext('k3d-edge', deps);
    assert.equal(result.success, true);
    assert.deepEqual(client.switches, ['k3d-edge']);
    assert.equal(result.activeCluster?.id, 'k3d-edge');
    assert.equal(result.activeCluster?.isCurrentContext, true);
    // The message names the cluster by its display name, not its id.
    assert.match(result.message, /\[edge\] \(K3D\)/);
  });

  it('returns success:false for an unknown id without switching', async () => {
    const { client, deps } = threeClusterClient();
    const result = await switchClusterContext('no-such-cluster', deps);
    assert.equal(result.success, false);
    assert.equal(result.activeCluster, null);
    assert.match(result.message, /not found/);
    assert.deepEqual(client.switches, []);
  });

  it('returns success:false when the target API is unreachable after the switch', async () => {
    const { client } = threeClusterClient();
    // Point k3d-edge at a dead API: the kubectl switch succeeds, the
    // verification probe does not.
    const dead = new StubClient(
      ['kind-local', 'k3d-edge'],
      'kind-local',
      {
        'kind-local': {
          telemetry: telemetry({ context: 'kind-local', detectedPlatform: 'kind' }),
          argo: { installed: false, applications: [] },
        },
        'k3d-edge': {
          telemetry: telemetry({
            context: 'k3d-edge',
            detectedPlatform: 'k3d',
            isConnected: false,
            nodeCount: 0,
            podCount: 0,
            nodes: [],
          }),
          argo: { installed: false, applications: [] },
        },
      }
    );
    const result = await switchClusterContext('k3d-edge', { client: dead, cdRunner: 'argocd' });
    assert.equal(result.success, false);
    assert.match(result.message, /not reachable/);
    assert.deepEqual(client.switches, []);
    assert.deepEqual(dead.switches, ['k3d-edge']);
  });

  it('throws ClusterUnavailableError when no contexts are configured', async () => {
    const empty = new StubClient([], '', {});
    await assert.rejects(
      () => switchClusterContext('kind-local', { client: empty }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });
});

describe('broadcastApplication (wired)', () => {
  it('syncs each target via the configured runner and aggregates per-cluster outcomes', async () => {
    const { client, deps } = threeClusterClient();
    const syncCalls: { runner: string; appId: string; root: string }[] = [];
    const sync = async (runner: 'argocd' | 'flux', appId: string, projectRoot: string) => {
      syncCalls.push({ runner, appId, root: projectRoot });
      return waitResult(0);
    };
    const result = await broadcastApplication('nextcloud', ['kind-local', 'k3d-edge'], {
      ...deps,
      syncApp: sync,
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.deployedClusters, ['local', 'edge']);
    assert.deepEqual(result.failedClusters, []);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.success));
    assert.deepEqual(syncCalls, [
      { runner: 'argocd', appId: 'nextcloud', root: '/tmp/vow-fleet-test' },
      { runner: 'argocd', appId: 'nextcloud', root: '/tmp/vow-fleet-test' },
    ]);
    // Context switches: one per target, then restore to the original.
    assert.deepEqual(client.switches, ['kind-local', 'k3d-edge', 'kind-local']);
    assert.equal(client.getContexts().current, 'kind-local');
  });

  it('reports partial failure per cluster instead of a blanket success', async () => {
    const { client, deps } = threeClusterClient();
    const sync = async () => waitResult(1, 'task_fail');
    const result = await broadcastApplication('nextcloud', ['kind-local', 'k3d-edge'], {
      ...deps,
      syncApp: sync,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deployedClusters, []);
    assert.deepEqual(result.failedClusters, ['local', 'edge']);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => !r.success));
    assert.match(result.results[0].message, /exit 1, task task_fail/);
    // Even on total failure the original context is restored.
    assert.equal(client.getContexts().current, 'kind-local');
    assert.deepEqual(client.switches, ['kind-local', 'k3d-edge', 'kind-local']);
  });

  it('mixes success and failure: one bad target does not abort the others', async () => {
    const { deps } = threeClusterClient();
    const calls: string[] = [];
    const flaky = async (_runner: 'argocd' | 'flux', appId: string, _root: string) => {
      calls.push(appId);
      if (calls.length === 1) return waitResult(0);
      throw new Error('argocd: connection refused');
    };
    const result = await broadcastApplication('keycloak', ['kind-local', 'k3d-edge'], {
      ...deps,
      syncApp: flaky,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deployedClusters, ['local']);
    assert.deepEqual(result.failedClusters, ['edge']);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[1].success, false);
    assert.match(result.results[1].message, /connection refused/);
  });

  it('skips an unreachable target without syncing it', async () => {
    const deadEdge = new StubClient(
      ['kind-local', 'k3d-edge'],
      'kind-local',
      {
        'kind-local': {
          telemetry: telemetry({ context: 'kind-local', detectedPlatform: 'kind' }),
          argo: { installed: false, applications: [] },
        },
        'k3d-edge': {
          telemetry: telemetry({
            context: 'k3d-edge',
            detectedPlatform: 'k3d',
            isConnected: false,
            nodeCount: 0,
            podCount: 0,
            nodes: [],
          }),
          argo: { installed: false, applications: [] },
        },
      }
    );
    let syncCalls = 0;
    const result = await broadcastApplication('nextcloud', ['kind-local', 'k3d-edge'], {
      client: deadEdge,
      cdRunner: 'argocd',
      syncApp: async () => {
        syncCalls++;
        return waitResult(0);
      },
    });
    assert.equal(syncCalls, 1);
    assert.equal(result.success, false);
    assert.deepEqual(result.deployedClusters, ['kind-local']);
    assert.deepEqual(result.failedClusters, ['k3d-edge']);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[1].success, false);
    assert.match(result.results[1].message, /not reachable/);
  });

  it('returns success:false with empty results when nothing matches (C4)', async () => {
    const { client, deps } = threeClusterClient();
    let syncCalls = 0;
    const result = await broadcastApplication('my-app', ['no-such-cluster'], {
      ...deps,
      syncApp: async () => {
        syncCalls++;
        return waitResult(0);
      },
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deployedClusters, []);
    assert.deepEqual(result.results, []);
    assert.equal(syncCalls, 0);
    assert.deepEqual(client.switches, []);
  });

  it('ignores unknown ids in the message but still syncs the known targets', async () => {
    const { deps } = threeClusterClient();
    const result = await broadcastApplication('nextcloud', ['kind-local', 'no-such-cluster'], {
      ...deps,
      syncApp: async () => waitResult(0),
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.deployedClusters, ['local']);
    assert.match(result.message, /Unknown cluster ids ignored: no-such-cluster/);
  });

  it('uses the flux runner when cdRunner is flux', async () => {
    const { deps } = threeClusterClient();
    const runners: string[] = [];
    const result = await broadcastApplication('nextcloud', ['kind-local'], {
      ...deps,
      cdRunner: 'flux',
      syncApp: async (runner) => {
        runners.push(runner);
        return waitResult(0);
      },
    });
    assert.equal(result.success, true);
    assert.deepEqual(runners, ['flux']);
  });

  it('throws ClusterUnavailableError when no contexts are configured', async () => {
    const empty = new StubClient([], '', {});
    await assert.rejects(
      () =>
        broadcastApplication('nextcloud', ['kind-local'], {
          client: empty,
          syncApp: async () => waitResult(0),
        }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });
});
