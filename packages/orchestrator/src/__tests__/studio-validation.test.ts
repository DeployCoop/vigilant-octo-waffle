import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  drDrillSchema,
  driftRemediateSchema,
  ebpfInspectSchema,
  fleetActionSchema,
  guardToggleSchema,
  guardEvaluateSchema,
  kedaLoadSchema,
  meshEnforceSchema,
  migrateLintSchema,
  migrateExecuteSchema,
  postmortemGenerateSchema,
  previewsCreateSchema,
  previewsExtendSchema,
  rewindActionSchema,
  secretopsRotateSchema,
  secretopsSealedSchema,
  sloToggleSchema,
  wasmDeploySchema,
} from '../studio-validation.js';

/** Batch C, C7: studio route schemas reject instead of coercing. */

describe('studio-validation (C7)', () => {
  it('previews: rejects NaN, strings, fractions, zero and negative prNumber; defaults ttlMinutes to 120', () => {
    const base = { prNumber: 12, branch: 'main', appName: 'app' };
    assert.equal(previewsCreateSchema.safeParse({ ...base, prNumber: Number.NaN }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, prNumber: '12' }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, prNumber: 12.5 }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, prNumber: 0 }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, prNumber: -1 }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, ttlMinutes: -5 }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, ttlMinutes: 0 }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, ttlMinutes: 10081 }).success, false);
    assert.equal(previewsCreateSchema.safeParse({ ...base, branch: '' }).success, false);
    const ok = previewsCreateSchema.parse(base);
    assert.equal(ok.ttlMinutes, 120);
    assert.equal(previewsCreateSchema.parse({ ...base, ttlMinutes: 10080 }).ttlMinutes, 10080);
  });

  it('previews extend: rejects non-positive additionalMinutes', () => {
    assert.equal(previewsExtendSchema.safeParse({ id: 'x', additionalMinutes: 0 }).success, false);
    assert.equal(previewsExtendSchema.safeParse({ id: 'x', additionalMinutes: '60' }).success, false);
    assert.equal(previewsExtendSchema.parse({ id: 'x' }).additionalMinutes, 60);
  });

  it('keda: rejects negative targetRps (the old totalRequests: -250 repro), out-of-range durations, bad patterns, string numerics', () => {
    const base = { targetWorkload: 'nextcloud-worker' };
    assert.equal(kedaLoadSchema.safeParse({ ...base, targetRps: -50 }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, targetRps: 0 }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, durationSeconds: 3 }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, durationSeconds: 61 }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, durationSeconds: 15.5 }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, pattern: 'BURST' }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, virtualUsers: '20' }).success, false);
    assert.equal(kedaLoadSchema.safeParse({ ...base, targetRps: '250' }).success, false);
    const ok = kedaLoadSchema.parse(base);
    assert.equal(ok.virtualUsers, 20);
    assert.equal(ok.durationSeconds, 15);
    assert.equal(ok.targetRps, 250);
    assert.equal(ok.pattern, 'SPIKE');
  });

  it('postmortem: rejects bad severity and non-array/empty affectedWorkloads; applies defaults', () => {
    assert.equal(
      postmortemGenerateSchema.safeParse({ severity: 'SEV-9' }).success,
      false
    );
    assert.equal(
      postmortemGenerateSchema.safeParse({ affectedWorkloads: 'keycloak' }).success,
      false
    );
    assert.equal(
      postmortemGenerateSchema.safeParse({ affectedWorkloads: [] }).success,
      false
    );
    assert.equal(
      postmortemGenerateSchema.safeParse({ affectedWorkloads: [''] }).success,
      false
    );
    const ok = postmortemGenerateSchema.parse({});
    assert.equal(ok.severity, 'SEV-2');
    assert.deepEqual(ok.affectedWorkloads, ['keycloak-0', 'postgres-postgresql-0']);
    assert.equal(ok.incidentTitle, 'Cascading Timeout on Authentication Subsystem');
  });

  it('ebpf: rejects port 0, 65536 and string ports; defaults to 80', () => {
    assert.equal(
      ebpfInspectSchema.safeParse({ sourcePod: 'a', targetPod: 'b', port: 0 }).success,
      false
    );
    assert.equal(
      ebpfInspectSchema.safeParse({ sourcePod: 'a', targetPod: 'b', port: 65536 }).success,
      false
    );
    assert.equal(
      ebpfInspectSchema.safeParse({ sourcePod: 'a', targetPod: 'b', port: '80' }).success,
      false
    );
    assert.equal(
      ebpfInspectSchema.safeParse({ sourcePod: '', targetPod: 'b' }).success,
      false
    );
    const ok = ebpfInspectSchema.parse({ sourcePod: 'a', targetPod: 'b' });
    assert.equal(ok.port, 80);
    assert.equal(ebpfInspectSchema.parse({ sourcePod: 'a', targetPod: 'b', port: 5432 }).port, 5432);
  });

  it('fleet: rejects empty target arrays and unknown actions', () => {
    assert.equal(
      fleetActionSchema.safeParse({ action: 'broadcast', appId: 'x', targetClusterIds: [] }).success,
      false
    );
    assert.equal(
      fleetActionSchema.safeParse({ action: 'broadcast', appId: 'x', targetClusterIds: 'c1' }).success,
      false
    );
    assert.equal(fleetActionSchema.safeParse({ action: 'explode' }).success, false);
    assert.equal(
      fleetActionSchema.safeParse({ action: 'switch_context', clusterId: '' }).success,
      false
    );
    const ok = fleetActionSchema.parse({
      action: 'broadcast',
      appId: 'x',
      targetClusterIds: ['cluster-kind-local'],
    });
    assert.equal(ok.action, 'broadcast');
  });

  it('mesh/wasm: reject names that are not DNS-1123 labels (injection-shaped input included)', () => {
    assert.equal(meshEnforceSchema.safeParse({ namespace: 'Bad_Name' }).success, false);
    assert.equal(meshEnforceSchema.safeParse({ namespace: 'UPPER' }).success, false);
    assert.equal(
      meshEnforceSchema.safeParse({ namespace: 'ns\ninjected: true' }).success,
      false
    );
    assert.equal(meshEnforceSchema.safeParse({ namespace: 'good-ns' }).success, true);
    assert.equal(
      wasmDeploySchema.safeParse({ serviceId: 'wasm-rust-kv', namespace: 'default' }).success,
      true
    );
    assert.equal(
      wasmDeploySchema.safeParse({ serviceId: 'WASM-RUST-KV' }).success,
      false
    );
    assert.equal(wasmDeploySchema.parse({ serviceId: 'wasm-rust-kv' }).namespace, 'default');
  });

  it('secretops: secretName follows DNS-1123 subdomain (dots allowed), namespace is a label', () => {
    assert.equal(
      secretopsRotateSchema.safeParse({ secretName: 'my.secret', namespace: 'default' }).success,
      true
    );
    assert.equal(
      secretopsRotateSchema.safeParse({ secretName: 'bad name', namespace: 'default' }).success,
      false
    );
    assert.equal(
      secretopsSealedSchema.safeParse({ secretName: 's', namespace: 'Bad_Ns' }).success,
      false
    );
  });

  it('slo/guard toggle: tripped/enabled must be real booleans, not coercible values', () => {
    assert.equal(
      sloToggleSchema.safeParse({ serviceId: 'x', tripped: 'true' }).success,
      false
    );
    assert.equal(sloToggleSchema.safeParse({ serviceId: 'x', tripped: 1 }).success, false);
    assert.equal(sloToggleSchema.safeParse({ serviceId: 'x', tripped: true }).success, true);
    assert.equal(guardToggleSchema.safeParse({ ruleId: 'x', enabled: 1 }).success, false);
    assert.equal(guardToggleSchema.safeParse({ ruleId: 'x', enabled: false }).success, true);
    assert.equal(guardToggleSchema.safeParse({ ruleId: '', enabled: true }).success, false);
  });

  it('dr/drift/rewind/migrate: unknown scenarios, empty ids and empty sql are rejected', () => {
    assert.equal(drDrillSchema.safeParse({ scenario: 'NOPE' }).success, false);
    assert.equal(drDrillSchema.parse({}).scenario, 'POSTGRES_VOLUME_CORRUPTION');
    assert.equal(driftRemediateSchema.safeParse({ driftId: '' }).success, false);
    assert.equal(rewindActionSchema.safeParse({ snapshotId: '' }).success, false);
    assert.equal(migrateLintSchema.safeParse({ sql: '' }).success, false);
    assert.equal(migrateExecuteSchema.safeParse({ version: 'v1', sql: '' }).success, false);
    assert.equal(migrateExecuteSchema.safeParse({ version: '', sql: 'SELECT 1' }).success, false);
    assert.equal(guardEvaluateSchema.safeParse({ yaml: '' }).success, false);
  });

  it('a failed parse produces a structural ZodError (name + issues) for route-error mapping', () => {
    const result = previewsCreateSchema.safeParse({ prNumber: 'x', branch: 'b', appName: 'a' });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.name, 'ZodError');
      assert.ok(Array.isArray(result.error.issues));
      assert.ok(result.error.issues.length > 0);
    }
  });
});
