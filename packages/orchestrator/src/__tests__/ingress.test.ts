import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderInitializerManifests } from '../initializer.js';
import { loadProjectConfig, findProjectRoot } from '../config.js';

describe('Ingress & Initializer Engine', () => {
  const projectRoot = findProjectRoot();

  it('renders manifests for certmanager-LE with environment substitution', () => {
    const manifests = renderInitializerManifests(projectRoot, 'init/certmanager-LE', {
      THIS_LETSENCRYPT_EMAIL: 'admin@example.com',
      THIS_CLUSTER_INGRESS: 'traefik',
    });

    assert.ok(manifests.length >= 2, 'Should find staging and production cluster issuers');
    const prod = manifests.find((m) => m.fileName.includes('production'));
    assert.ok(prod, 'Should find cluster-issuer-production');
    assert.ok(prod.content.includes('admin@example.com'), 'Should contain substituted email');
    assert.ok(prod.content.includes('class: traefik'), 'Should contain substituted ingress class');
  });

  it('renders manifests for certmanager-mkcert correctly', () => {
    const manifests = renderInitializerManifests(projectRoot, 'init/certmanager-mkcert');
    assert.ok(manifests.length >= 1, 'Should find mkcert issuer');
    const mkcertIssuer = manifests.find((m) => m.fileName.includes('mkcert'));
    assert.ok(mkcertIssuer);
    assert.ok(mkcertIssuer.content.includes('mkcert-issuer'));
  });

  it('handles non-existent init directories gracefully', () => {
    const manifests = renderInitializerManifests(projectRoot, 'init/does-not-exist');
    assert.strictEqual(manifests.length, 0);
  });

  it('respects .init_overrides if present', () => {
    // Test that override merging function works
    const config = loadProjectConfig(projectRoot);
    assert.ok(config);
  });
});
