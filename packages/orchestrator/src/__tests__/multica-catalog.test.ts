import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listCatalogApps, renderAppManifest } from '../app-deployer.js';
import { renderInitializerManifests } from '../initializer.js';
import { APP_CATALOG } from '../registry.js';
import { findProjectRoot } from '../config.js';
import { parseYaml } from '../yaml.js';

/**
 * Multica catalog app (argo/multica + init/pre-multica):
 * - listed under AI / ML Platforms with an ArgoCD manifest and pre-step
 * - OCI chart pinned to 0.11.1, telemetry off, no secret values in git
 * - rendered manifest + embedded Helm values parse as YAML with the
 *   expected hosts, ingress, storage class, and backend config
 */

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.ok(value !== null);
  return value as Record<string, unknown>;
}

function asList(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value as unknown[];
}

describe('Multica catalog app', () => {
  const projectRoot = findProjectRoot();

  it('lists multica under AI / ML Platforms with manifest and pre-step', () => {
    const apps = listCatalogApps(projectRoot);
    const multica = apps.find((a) => a.appId === 'multica');
    assert.ok(multica, 'Should find multica in catalog');
    assert.strictEqual(multica.category, 'AI / ML Platforms');
    assert.strictEqual(multica.hasArgoManifest, true);
    assert.strictEqual(multica.hasInit, true);
    assert.strictEqual(multica.defaultNamespace, 'multica');
    assert.strictEqual(multica.enablerVar, 'THIS_MULTICA_ENABLED');
  });

  it('registers multica in APP_CATALOG under AI, ML & GPU', () => {
    const multica = APP_CATALOG.find((a) => a.id === 'multica');
    assert.ok(multica, 'Multica must be in APP_CATALOG');
    assert.strictEqual(multica.category, 'AI, ML & GPU');
    assert.strictEqual(multica.argoPath, 'argo/multica');
    assert.strictEqual(multica.initPath, 'init/pre-multica');
    assert.strictEqual(multica.subdomain, 'multica');
    assert.strictEqual(multica.port, 3000);
  });

  it('ships no secret values in the ArgoCD manifest', () => {
    const raw = fs.readFileSync(path.join(projectRoot, 'argo', 'multica', 'argocd.yaml'), 'utf-8');
    for (const secretKey of [
      'JWT_SECRET',
      'POSTGRES_PASSWORD',
      'RESEND_API_KEY',
      'GOOGLE_CLIENT_SECRET',
      'CLOUDFRONT_PRIVATE_KEY',
      'MULTICA_DEV_VERIFICATION_CODE',
    ]) {
      assert.ok(!raw.includes(secretKey), `Manifest must not mention ${secretKey}`);
    }
    assert.ok(raw.includes('targetRevision: 0.11.1'), 'Chart must be pinned to 0.11.1');
    assert.ok(raw.includes('doNotTrack: "1"'), 'Telemetry must be disabled');
  });

  it('renders the manifest with substituted hosts, ingress, and values', () => {
    const manifest = renderAppManifest(projectRoot, 'multica', {
      THIS_MULTICA_HOST: 'tasks',
      THIS_DOMAIN: 'internal.local',
      THIS_CLUSTER_INGRESS: 'traefik',
      THIS_CLUSTER_ISSUER: 'letsencrypt-prod',
      THIS_STORAGECLASS: 'local-path',
      THIS_NAMESPACE: 'demo',
    });
    assert.ok(manifest, 'Should render multica manifest');
    assert.ok(!manifest.includes('${'), 'No variable reference may survive rendering');

    const doc = parseYaml<Record<string, unknown>>(manifest);
    assert.strictEqual(asRecord(doc.metadata).name, 'multica-demo');
    const spec = asRecord(doc.spec);
    assert.strictEqual(asRecord(spec.destination).namespace, 'demo');
    assert.strictEqual(asRecord(spec.destination).server, 'https://kubernetes.default.svc');
    const source = asRecord(spec.source);
    assert.strictEqual(source.repoURL, 'oci://ghcr.io/multica-ai/charts/multica');
    assert.strictEqual(source.chart, 'multica');
    assert.strictEqual(source.targetRevision, '0.11.1');
    const helm = asRecord(source.helm);
    assert.strictEqual(helm.releaseName, 'multica');
    assert.equal(typeof helm.values, 'string');

    const values = parseYaml<Record<string, unknown>>(helm.values as string);
    assert.strictEqual(values.existingSecret, 'multica-secrets');
    assert.strictEqual(
      asRecord(asRecord(values.postgres).persistence).storageClass,
      'local-path'
    );
    const backend = asRecord(values.backend);
    assert.strictEqual(
      asRecord(asRecord(asRecord(backend.uploads).persistence)).storageClass,
      'local-path'
    );
    const config = asRecord(backend.config);
    assert.strictEqual(config.appUrl, 'https://tasks.internal.local');
    assert.strictEqual(config.frontendOrigin, 'https://tasks.internal.local');
    assert.strictEqual(config.googleRedirectUri, 'https://tasks.internal.local/auth/callback');
    assert.strictEqual(config.localUploadBaseUrl, 'https://api.tasks.internal.local');
    assert.strictEqual(config.doNotTrack, '1');
    const ingress = asRecord(values.ingress);
    assert.strictEqual(ingress.className, 'traefik');
    assert.strictEqual(
      asRecord(ingress.annotations)['cert-manager.io/cluster-issuer'],
      'letsencrypt-prod'
    );
    assert.strictEqual(asRecord(ingress.frontend).host, 'tasks.internal.local');
    assert.strictEqual(asRecord(ingress.backend).host, 'api.tasks.internal.local');
    const tls = asList(ingress.tls);
    assert.strictEqual(tls.length, 1);
    const tlsEntry = asRecord(tls[0]);
    assert.strictEqual(tlsEntry.secretName, 'multica-tls');
    assert.deepStrictEqual(asList(tlsEntry.hosts), [
      'tasks.internal.local',
      'api.tasks.internal.local',
    ]);
  });

  it('renders the pre-step secret from operator-supplied values only', () => {
    const raw = fs.readFileSync(
      path.join(projectRoot, 'init', 'pre-multica', 'secret.yaml'),
      'utf-8'
    );
    // The template carries variable references, never values.
    assert.ok(raw.includes('${THIS_MULTICA_JWT_SECRET}'));
    assert.ok(raw.includes('${THIS_MULTICA_POSTGRES_PASSWORD}'));
    // The key name appears only in the comment explaining its absence;
    // it must never be provisioned as a YAML key (no fixed dev code).
    assert.ok(!/^\s*MULTICA_DEV_VERIFICATION_CODE:/m.test(raw));

    const rendered = renderInitializerManifests(projectRoot, 'init/pre-multica', {
      THIS_NAMESPACE: 'demo',
      THIS_MULTICA_JWT_SECRET: 'test-jwt-secret-value',
      THIS_MULTICA_POSTGRES_PASSWORD: 'test-postgres-password-value',
      THIS_MULTICA_RESEND_API_KEY: '',
      THIS_MULTICA_GOOGLE_CLIENT_SECRET: '',
      THIS_MULTICA_CLOUDFRONT_PRIVATE_KEY: '',
    });
    assert.strictEqual(rendered.length, 1);
    assert.strictEqual(rendered[0].fileName, 'secret.yaml');
    assert.ok(!rendered[0].content.includes('$('), 'No unevaluated shell expression may survive');

    const secret = parseYaml<Record<string, unknown>>(rendered[0].content);
    assert.strictEqual(secret.kind, 'Secret');
    assert.strictEqual(asRecord(secret.metadata).name, 'multica-secrets');
    assert.strictEqual(asRecord(secret.metadata).namespace, 'demo');
    const stringData = asRecord(secret.stringData);
    assert.strictEqual(stringData.JWT_SECRET, 'test-jwt-secret-value');
    assert.strictEqual(stringData.POSTGRES_PASSWORD, 'test-postgres-password-value');
    assert.strictEqual(stringData.RESEND_API_KEY, '');
  });
});
