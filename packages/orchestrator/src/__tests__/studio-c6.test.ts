import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../yaml.js';
import { enforceStrictMtls } from '../mesh.js';
import { deployWasmMicroservice } from '../wasm.js';

/** Batch C, C6: manifests are built as objects and serialized, so values cannot break out of the YAML structure. */

function parseAllDocuments(manifest: string): Array<Record<string, unknown>> {
  return manifest
    .split('---\n')
    .filter((doc) => doc.trim().length > 0)
    .map((doc) => parseYaml<Record<string, unknown>>(doc));
}

describe('manifests as objects (C6)', () => {
  it('mesh: strict-mTLS policy parses back with the namespace as a value, not a field', async () => {
    const result = await enforceStrictMtls('payments');
    assert.equal(result.success, true);
    const doc = parseYaml<Record<string, unknown>>(result.manifest);
    assert.equal(doc.kind, 'CiliumClusterwideNetworkPolicy');
    const metadata = doc.metadata as Record<string, unknown>;
    assert.equal(metadata.name, 'strict-mtls-payments');
    const spec = doc.spec as Record<string, unknown>;
    const selector = spec.endpointSelector as Record<string, unknown>;
    const matchLabels = selector.matchLabels as Record<string, unknown>;
    // The dotted key survives the serializer as one quoted key.
    assert.equal(matchLabels['k8s:io.kubernetes.pod.namespace'], 'payments');
  });

  it('mesh: a newline-bearing namespace cannot inject YAML fields', async () => {
    const evil = 'evil\ninjected-field: pwned';
    const result = await enforceStrictMtls(evil);
    const doc = parseYaml<Record<string, unknown>>(result.manifest);
    assert.equal('injected-field' in doc, false);
    const spec = doc.spec as Record<string, unknown>;
    const selector = spec.endpointSelector as Record<string, unknown>;
    const matchLabels = selector.matchLabels as Record<string, unknown>;
    assert.equal(matchLabels['k8s:io.kubernetes.pod.namespace'], evil);
  });

  it('wasm: Deployment + Service manifests parse back as two documents', async () => {
    const result = await deployWasmMicroservice('wasm-rust-kv', 'default');
    assert.equal(result.success, true);
    const docs = parseAllDocuments(result.manifest);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].kind, 'Deployment');
    assert.equal(docs[1].kind, 'Service');
    const deployment = docs[0];
    const spec = deployment.spec as Record<string, unknown>;
    const template = spec.template as Record<string, unknown>;
    const podSpec = template.spec as Record<string, unknown>;
    assert.equal(podSpec.runtimeClassName, 'wasmtime-spin-v2');
    const containers = podSpec.containers as Array<Record<string, unknown>>;
    assert.equal(containers[0].image, 'localhost:5000/wasm/wasm-rust-kv:v1.0.0');
  });

  it('wasm: a newline-bearing namespace cannot inject YAML fields', async () => {
    const evil = 'evil\ninjected-field: pwned';
    const result = await deployWasmMicroservice('wasm-rust-kv', evil);
    const docs = parseAllDocuments(result.manifest);
    for (const doc of docs) {
      assert.equal('injected-field' in doc, false);
      assert.equal((doc.metadata as Record<string, unknown>).namespace, evil);
    }
  });
});
