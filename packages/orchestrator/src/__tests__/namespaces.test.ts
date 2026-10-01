import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverClusterNamespaces,
  buildNamespaceObject,
  generateNamespaceManifests,
  generateSingleNamespaceManifest,
} from '../namespaces.js';

describe('Namespace Registry and PSS Compliance', () => {
  it('discovers core and user namespaces from config', () => {
    const result = discoverClusterNamespaces(process.cwd());
    assert.ok(result.total > 0);
    assert.ok(result.namespaces.some((n) => n.name === 'argocd'));
    assert.ok(result.namespaces.some((n) => n.name === 'monitoring'));
    assert.ok(result.namespaces.some((n) => n.name === 'openebs'));
    assert.ok(result.byCategory.core || result.byCategory.gitops || result.byCategory.storage);
  });

  it('assigns privileged PSS level to storage and system namespaces', () => {
    const result = discoverClusterNamespaces(process.cwd());
    const openebs = result.namespaces.find((n) => n.name === 'openebs');
    assert.ok(openebs);
    assert.strictEqual(openebs.pssEnforce, 'privileged');

    const argocd = result.namespaces.find((n) => n.name === 'argocd');
    assert.ok(argocd);
    assert.strictEqual(argocd.pssEnforce, 'baseline');
  });

  it('builds standard Kubernetes namespace object with security labels', () => {
    const obj = buildNamespaceObject({
      name: 'test-app',
      category: 'app',
      pssEnforce: 'baseline',
      pssWarn: 'restricted',
      pssAudit: 'restricted',
    });

    assert.strictEqual(obj.apiVersion, 'v1');
    assert.strictEqual(obj.kind, 'Namespace');
    assert.strictEqual(obj.metadata.name, 'test-app');
    assert.strictEqual(obj.metadata.labels['pod-security.kubernetes.io/enforce'], 'baseline');
    assert.strictEqual(obj.metadata.labels['pod-security.kubernetes.io/warn'], 'restricted');
    assert.strictEqual(obj.metadata.labels['pod-security.kubernetes.io/audit'], 'restricted');
    assert.strictEqual(obj.metadata.labels['app.kubernetes.io/managed-by'], 'vow');
  });

  it('generates single and multi-document YAML manifests', () => {
    const singleYaml = generateSingleNamespaceManifest('custom-ns', 'baseline');
    assert.ok(singleYaml.includes('name: custom-ns'));
    assert.ok(singleYaml.includes('pod-security.kubernetes.io/enforce: baseline'));

    const multiYaml = generateNamespaceManifests([
      { name: 'ns1', category: 'app', pssEnforce: 'baseline', pssWarn: 'restricted', pssAudit: 'restricted' },
      { name: 'ns2', category: 'storage', pssEnforce: 'privileged', pssWarn: 'baseline', pssAudit: 'baseline' },
    ]);
    assert.ok(multiYaml.includes('name: ns1'));
    assert.ok(multiYaml.includes('name: ns2'));
    assert.ok(multiYaml.includes('---'));
  });
});
