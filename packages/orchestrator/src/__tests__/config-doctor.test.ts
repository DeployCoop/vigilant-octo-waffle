import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  checkConfig,
  reconcileConfig,
  cascadeConfigUpdates,
  DEPENDENCY_DEFINITIONS,
} from '../index.js';

describe('Config Doctor & Variable Cascading Engine (Phase 1)', () => {
  const projectRoot = path.resolve(process.cwd(), '../..');

  it('identifies dependency definitions for all core variables', () => {
    assert.ok(DEPENDENCY_DEFINITIONS['THIS_DOMAIN']);
    assert.ok(DEPENDENCY_DEFINITIONS['THIS_NAMESPACE']);
    assert.ok(DEPENDENCY_DEFINITIONS['THIS_SECRETS']);
    assert.ok(DEPENDENCY_DEFINITIONS['KEY_FILE']);
    assert.ok(DEPENDENCY_DEFINITIONS['SECRET_FILE']);
    assert.ok(DEPENDENCY_DEFINITIONS['THIS_OPENSEARCH_NAMESPACE']);
    assert.ok(DEPENDENCY_DEFINITIONS['THIS_HOSTPATH_STORAGECLASS']);
  });

  it('runs checkConfig on project root without throwing', () => {
    const report = checkConfig(projectRoot);
    assert.ok(report);
    assert.ok(typeof report.valid === 'boolean');
    assert.ok(report.timestamp);
    assert.ok(Array.isArray(report.issues));
    assert.ok(report.summary);
    assert.ok(typeof report.summary.totalIssues === 'number');
  });

  it('cascades derived variables when THIS_NAME changes', () => {
    const initialRaw: Record<string, string> = {
      THIS_NAME: 'example',
      THIS_TLD: 'net',
      THIS_ADMIN_USER: 'admin',
      THIS_DOMAIN: 'example.net',
      THIS_NAMESPACE: 'example',
      THIS_SECRETS: 'example-secrets',
      KEY_FILE: './.secrets/example-secrets-plain.yaml',
      SECRET_FILE: './.secrets/example-secrets.yaml',
      THIS_LVM_VG: 'exampleVG',
    };

    const updates = {
      THIS_NAME: 'monitaur',
    };

    const cascaded = cascadeConfigUpdates(initialRaw, updates);

    assert.equal(cascaded['THIS_NAME'], 'monitaur');
    assert.equal(cascaded['THIS_DOMAIN'], 'monitaur.net');
    assert.equal(cascaded['THIS_NAMESPACE'], 'monitaur');
    assert.equal(cascaded['THIS_SECRETS'], 'monitaur-secrets');
    assert.equal(cascaded['KEY_FILE'], './.secrets/monitaur-secrets-plain.yaml');
    assert.equal(cascaded['SECRET_FILE'], './.secrets/monitaur-secrets.yaml');
    assert.equal(cascaded['THIS_LVM_VG'], 'monitaurVG');
  });

  it('cascades derived variables when THIS_NAMESPACE changes', () => {
    const initialRaw: Record<string, string> = {
      THIS_NAME: 'monitaur',
      THIS_NAMESPACE: 'monitaur',
      THIS_OPENSEARCH_NAMESPACE: 'monitaur',
      THIS_HOSTPATH_STORAGECLASS: 'monitaur-hostpath',
    };

    const updates = {
      THIS_NAMESPACE: 'custom-ns',
    };

    const cascaded = cascadeConfigUpdates(initialRaw, updates);

    assert.equal(cascaded['THIS_NAMESPACE'], 'custom-ns');
    assert.equal(cascaded['THIS_OPENSEARCH_NAMESPACE'], 'custom-ns');
    assert.equal(cascaded['THIS_HOSTPATH_STORAGECLASS'], 'custom-ns-hostpath');
  });

  it('cleanses quote and inline comment corruptions during cascade', () => {
    const initialRaw: Record<string, string> = {
      THIS_CLUSTER_INGRESS: 'nginx\\\\\\"     # Ingress controller (nginx or traefik)',
      THIS_LVM_VG: 'AirVG\\\\\\"     # LVM volume group name',
    };

    const cascaded = cascadeConfigUpdates(initialRaw, {});

    assert.equal(cascaded['THIS_CLUSTER_INGRESS'], 'nginx');
    assert.equal(cascaded['THIS_LVM_VG'], 'AirVG');
  });

  it('reconciles mock directory with stale example cascade and fixes issues', () => {
    const mockDir = path.resolve(projectRoot, '.vow-cache/test-doctor');
    if (!fs.existsSync(mockDir)) fs.mkdirSync(mockDir, { recursive: true });
    const srcDir = path.join(mockDir, 'src');
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

    // Write default.env and mismatched .env
    fs.writeFileSync(
      path.join(srcDir, 'default.env'),
      `: "\${THIS_NAME:=example}"\n: "\${THIS_NAMESPACE:=\${THIS_NAME}}"\n: "\${THIS_SECRETS:=\${THIS_NAME}-secrets}"\n`,
      'utf-8'
    );

    fs.writeFileSync(
      path.join(mockDir, '.env'),
      `THIS_NAME="acme"\nTHIS_NAMESPACE="example"\nTHIS_SECRETS="example-secrets"\n`,
      'utf-8'
    );

    const reportBefore = checkConfig(mockDir);
    assert.equal(reportBefore.valid, false);
    assert.ok(reportBefore.issues.some((i) => i.key === 'THIS_NAMESPACE'));
    assert.ok(reportBefore.issues.some((i) => i.key === 'THIS_SECRETS'));

    // Apply reconciliation
    const reportAfter = reconcileConfig(mockDir, { applyFixes: true });
    assert.ok(reportAfter.fixesApplied);
    assert.equal(reportAfter.fixesApplied['THIS_NAMESPACE'].to, 'acme');
    assert.equal(reportAfter.fixesApplied['THIS_SECRETS'].to, 'acme-secrets');

    const fixedContent = fs.readFileSync(path.join(mockDir, '.env'), 'utf-8');
    assert.ok(fixedContent.includes('THIS_NAMESPACE="acme"'));
    assert.ok(fixedContent.includes('THIS_SECRETS="acme-secrets"'));

    // Clean up mock directory
    fs.rmSync(mockDir, { recursive: true, force: true });
  });
});
