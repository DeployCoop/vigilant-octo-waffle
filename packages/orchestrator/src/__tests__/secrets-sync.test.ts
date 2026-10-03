import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  MODULAR_SECRET_BUNDLES,
  discoverTargetNamespaces,
  generateModularSecretBundles,
  buildSecretManifest,
  syncSecretsAcrossNamespaces,
  parseSecretYaml,
} from '../index.js';

describe('Granular Secrets & Cross-Namespace Distribution Engine (Phase 2)', () => {
  const projectRoot = path.resolve(process.cwd(), '../..');

  it('defines modular secret bundles for core, db, smtp, and apps', () => {
    assert.ok(MODULAR_SECRET_BUNDLES.length >= 4);
    const core = MODULAR_SECRET_BUNDLES.find((b) => b.id === 'core');
    const db = MODULAR_SECRET_BUNDLES.find((b) => b.id === 'db');
    const smtp = MODULAR_SECRET_BUNDLES.find((b) => b.id === 'smtp');
    const apps = MODULAR_SECRET_BUNDLES.find((b) => b.id === 'apps');

    assert.ok(core);
    assert.ok(core.keys.includes('argocdadmin-password'));
    assert.ok(db);
    assert.ok(db.keys.includes('db-admin-pass'));
    assert.ok(smtp);
    assert.ok(smtp.keys.includes('smtp-password'));
    assert.ok(apps);
    assert.ok(apps.keys.includes('HARBOR_ADMIN_PASSWORD'));
  });

  it('discovers target namespaces dynamically based on project configuration', () => {
    const namespaces = discoverTargetNamespaces(projectRoot);
    assert.ok(Array.isArray(namespaces));
    assert.ok(namespaces.length > 0);
    assert.ok(namespaces.includes('monitoring'));
    assert.ok(namespaces.includes('nfs-server'));
  });

  it('builds Kubernetes Secret manifest with Reflector annotations', () => {
    const manifest = buildSecretManifest({
      secretName: 'test-modular-secret',
      namespace: 'custom-ns',
      data: {
        'admin-key': 'supersecret123',
      },
      enableReflector: true,
      allowedReflectionNamespaces: 'airflow,monitoring',
    });

    assert.ok(manifest.includes('apiVersion: v1'));
    assert.ok(manifest.includes('kind: Secret'));
    assert.ok(manifest.includes('name: test-modular-secret'));
    assert.ok(manifest.includes('namespace: custom-ns'));
    assert.ok(manifest.includes('reflector.v1.k8s.emberstack.com/reflection-allowed'));
    assert.ok(manifest.includes('airflow,monitoring'));
    assert.ok(manifest.includes('admin-key:'));
  });

  it('generates modular secret bundles and master manifest with Reflector support', () => {
    const { bundles, monolithicManifest } = generateModularSecretBundles(projectRoot);
    assert.ok(bundles.length >= 4);
    assert.ok(monolithicManifest.includes('kind: Secret'));
    assert.ok(monolithicManifest.includes('reflector.v1.k8s.emberstack.com'));

    for (const b of bundles) {
      assert.ok(b.id);
      assert.ok(b.fileName.endsWith('.yaml'));
      assert.ok(b.manifest.includes('kind: Secret'));
    }
  });

  it('generates cross-namespace sync plan without errors in offline mode', async () => {
    const result = await syncSecretsAcrossNamespaces(projectRoot, {
      applyLiveCluster: false,
    });

    assert.ok(result);
    assert.ok(result.secretName);
    assert.ok(result.syncedNamespaces.length > 0);
    assert.ok(result.manifestsGenerated.length > 0);
    assert.equal(result.errors.length, 0);
  });
});
