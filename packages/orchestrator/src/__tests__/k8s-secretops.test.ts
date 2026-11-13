/**
 * K8sClient SecretOps read methods (Batch C, Phase 1): getSecrets,
 * getSecret, getConfigMaps, getPodSpecs, getExternalSecretsStatus.
 * The API clients are stubbed via the private-access pattern
 * (k8s.test.ts); the tests pin the wire-to-shape mapping — in
 * particular that the list read exposes key names only, never values.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { K8sClient } from '../k8s.js';

function notFoundError(): Error {
  const err = new Error('secrets "missing" not found');
  (err as { statusCode?: number }).statusCode = 404;
  return err;
}

function serverError(): Error {
  const err = new Error('Internal Server Error');
  (err as { statusCode?: number }).statusCode = 500;
  return err;
}

function stubbedClient(apis: {
  coreApi?: unknown;
  customApi?: unknown;
}): K8sClient {
  const client = new K8sClient();
  if (apis.coreApi !== undefined) {
    (client as unknown as { coreApi: unknown }).coreApi = apis.coreApi;
  }
  if (apis.customApi !== undefined) {
    (client as unknown as { customApi: unknown }).customApi = apis.customApi;
  }
  return client;
}

const CREATED = new Date('2026-08-01T00:00:00Z');

describe('getSecrets / getSecret', () => {
  const secret = {
    metadata: {
      name: 'db-creds',
      namespace: 'postgres',
      creationTimestamp: CREATED,
      annotations: { 'app.kubernetes.io/managed-by': 'argocd' },
      labels: { app: 'db' },
      ownerReferences: [{ kind: 'ExternalSecret', name: 'db-es' }],
      resourceVersion: '4242',
    },
    type: 'Opaque',
    data: { password: 'b2xkLXBhc3N3b3Jk', username: 'ZGJ1c2Vy' },
    immutable: false,
  };

  it('lists metadata with data key names only — never values', async () => {
    const client = stubbedClient({
      coreApi: { listSecretForAllNamespaces: async () => ({ items: [secret] }) },
    });
    const [info] = await client.getSecrets();
    assert.equal(info.name, 'db-creds');
    assert.equal(info.namespace, 'postgres');
    assert.equal(info.type, 'Opaque');
    assert.equal(info.creationTimestamp, CREATED.toISOString());
    assert.deepEqual(info.dataKeys, ['password', 'username']);
    assert.deepEqual(info.ownerKinds, ['ExternalSecret']);
    assert.equal(info.resourceVersion, '4242');
    assert.equal('data' in info, false);
    assert.equal(JSON.stringify(info).includes('b2xkLXBhc3N3b3Jk'), false);
  });

  it('getSecret returns the full data map; 404 is null, other errors throw', async () => {
    const client = stubbedClient({
      coreApi: {
        readNamespacedSecret: async ({ name }: { name: string }) => {
          if (name === 'db-creds') return secret;
          if (name === 'boom') throw serverError();
          throw notFoundError();
        },
      },
    });
    const found = await client.getSecret('db-creds', 'postgres');
    assert.equal(found?.data.password, 'b2xkLXBhc3N3b3Jk');
    assert.equal(found?.resourceVersion, '4242');
    assert.equal(await client.getSecret('missing', 'postgres'), null);
    await assert.rejects(() => client.getSecret('boom', 'postgres'), /Internal Server Error/);
  });

  it('throws when the API client is absent', async () => {
    const client = stubbedClient({});
    (client as unknown as { coreApi: unknown }).coreApi = undefined;
    await assert.rejects(() => client.getSecrets(), /not connected/);
    await assert.rejects(() => client.getSecret('x', 'default'), /not connected/);
  });
});

describe('getConfigMaps / getPodSpecs', () => {
  it('maps ConfigMap data and pod env/args/volumes/owners', async () => {
    const client = stubbedClient({
      coreApi: {
        listConfigMapForAllNamespaces: async () => ({
          items: [
            {
              metadata: { name: 'app-config', namespace: 'default' },
              data: { REDIS_PASSWORD: 'redis-secret', PLAIN: 'hello' },
            },
          ],
        }),
        listPodForAllNamespaces: async () => ({
          items: [
            {
              metadata: {
                name: 'app-abc',
                namespace: 'default',
                ownerReferences: [{ kind: 'ReplicaSet', name: 'app-xyz' }],
              },
              spec: {
                containers: [
                  {
                    name: 'app',
                    env: [
                      { name: 'LITERAL', value: 'plain-value' },
                      {
                        name: 'FROM_SECRET',
                        valueFrom: { secretKeyRef: { name: 'db-creds', key: 'password' } },
                      },
                      {
                        name: 'FROM_CM',
                        valueFrom: { configMapKeyRef: { name: 'app-config', key: 'PLAIN' } },
                      },
                    ],
                    envFrom: [{ secretRef: { name: 'db-creds' } }, { configMapRef: { name: 'app-config' } }],
                    args: ['--flag=value', 'positional'],
                  },
                ],
                volumes: [
                  { name: 'creds', secret: { secretName: 'db-creds' } },
                  { name: 'cfg', configMap: { name: 'app-config' } },
                  { name: 'cache', emptyDir: {} },
                ],
              },
            },
          ],
        }),
      },
    });
    const [cm] = await client.getConfigMaps();
    assert.equal(cm.name, 'app-config');
    assert.equal(cm.data.REDIS_PASSWORD, 'redis-secret');

    const [pod] = await client.getPodSpecs();
    assert.equal(pod.ownerKind, 'ReplicaSet');
    assert.equal(pod.ownerName, 'app-xyz');
    const [container] = pod.containers;
    assert.equal(container.env[0].value, 'plain-value');
    assert.equal(container.env[1].valueFromKind, 'secretKeyRef');
    assert.equal(container.env[1].valueFromName, 'db-creds');
    assert.equal(container.env[1].valueFromKey, 'password');
    assert.equal(container.env[2].valueFromKind, 'configMapKeyRef');
    assert.deepEqual(container.envFromSecrets, ['db-creds']);
    assert.deepEqual(container.envFromConfigMaps, ['app-config']);
    assert.deepEqual(container.args, ['--flag=value', 'positional']);
    assert.equal(pod.volumes[0].secretName, 'db-creds');
    assert.equal(pod.volumes[1].configMapName, 'app-config');
    assert.equal(pod.volumes[2].secretName, undefined);
  });
});

describe('getExternalSecretsStatus', () => {
  function customApi(
    externals: unknown[],
    stores: unknown[],
    failPlural?: string
  ): { listClusterCustomObject: (args: { plural: string }) => Promise<{ items: unknown[] }> } {
    return {
      listClusterCustomObject: async ({ plural }: { plural: string }) => {
        if (failPlural === plural) throw notFoundError();
        if (plural === 'externalsecrets') return { items: externals };
        if (plural === 'clustersecretstores') return { items: stores };
        throw new Error(`unexpected plural ${plural}`);
      },
    };
  }

  const readyCondition = { type: 'Ready', status: 'True' };

  it('reports connected when a store or an ExternalSecret is Ready', async () => {
    const client = stubbedClient({
      customApi: customApi(
        [{ metadata: { name: 'es-1' }, status: { conditions: [readyCondition] } }],
        [{ metadata: { name: 'vault' }, status: { conditions: [readyCondition] } }]
      ),
    });
    const status = await client.getExternalSecretsStatus();
    assert.equal(status.installed, true);
    assert.equal(status.externalSecretCount, 1);
    assert.equal(status.readyExternalSecretCount, 1);
    assert.equal(status.storeReady, true);
  });

  it('reports installed but not connected when nothing is Ready', async () => {
    const client = stubbedClient({
      customApi: customApi(
        [{ metadata: { name: 'es-1' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } }],
        []
      ),
    });
    const status = await client.getExternalSecretsStatus();
    assert.equal(status.installed, true);
    assert.equal(status.readyExternalSecretCount, 0);
    assert.equal(status.storeReady, false);
  });

  it('reports not installed when the CRDs are absent (404)', async () => {
    const client = stubbedClient({
      customApi: customApi([], [], 'externalsecrets'),
    });
    const status = await client.getExternalSecretsStatus();
    assert.equal(status.installed, false);
    assert.equal(status.readyExternalSecretCount, 0);
    assert.equal(status.storeReady, false);
  });

  it('throws on non-404 API failures', async () => {
    const client = stubbedClient({
      customApi: {
        listClusterCustomObject: async () => {
          throw serverError();
        },
      },
    });
    await assert.rejects(() => client.getExternalSecretsStatus(), /Internal Server Error/);
  });
});
