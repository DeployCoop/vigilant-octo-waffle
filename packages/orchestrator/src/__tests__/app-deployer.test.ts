import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listCatalogApps, renderAppManifest, rewriteApplicationName } from '../app-deployer.js';
import { findProjectRoot } from '../config.js';

describe('Application Catalog Deployer', () => {
  const projectRoot = findProjectRoot();

  it('scans the workspace and lists catalog applications', () => {
    const apps = listCatalogApps(projectRoot);
    assert.ok(apps.length > 20, `Expected > 20 catalog apps, found ${apps.length}`);

    const nextcloud = apps.find((a) => a.appId === 'nextcloud');
    assert.ok(nextcloud, 'Should find nextcloud in catalog');
    assert.strictEqual(nextcloud.hasArgoManifest, true);

    const airflow = apps.find((a) => a.appId === 'airflow');
    assert.ok(airflow, 'Should find airflow in catalog');
  });

  it('renders ArgoCD Application manifest for an app with variable substitution', () => {
    const manifest = renderAppManifest(projectRoot, 'nextcloud', {
      THIS_NC_HOST: 'cloud',
      THIS_DOMAIN: 'internal.local',
      THIS_CLUSTER_INGRESS: 'traefik',
    });

    assert.ok(manifest, 'Should render nextcloud manifest');
    assert.ok(manifest.includes('cloud.internal.local'), 'Should contain substituted FQDN');
    assert.ok(manifest.includes('traefik'), 'Should contain substituted ingress');
  });

  it('returns null when rendering non-existent app', () => {
    const manifest = renderAppManifest(projectRoot, 'non-existent-app-xyz');
    assert.strictEqual(manifest, null);
  });

  it('rewriteApplicationName renames only metadata.name (preview wiring)', () => {
    const manifest = renderAppManifest(projectRoot, 'nextcloud', {
      THIS_NC_HOST: 'cloud',
      THIS_DOMAIN: 'internal.local',
      THIS_CLUSTER_INGRESS: 'traefik',
    });
    assert.ok(manifest, 'Should render nextcloud manifest');

    const rewritten = rewriteApplicationName(manifest, 'preview-pr-42-nextcloud');
    assert.ok(rewritten.includes('name: preview-pr-42-nextcloud'));
    assert.ok(!rewritten.includes('name: examplenc'), 'Old Application name must be gone');
    assert.ok(rewritten.includes('cloud.internal.local'), 'Destination and source are untouched');
  });

  it('rewriteApplicationName throws on a manifest that is not a mapping', () => {
    assert.throws(() => rewriteApplicationName('- just\n- a\n- list\n', 'preview-x'));
  });
});
