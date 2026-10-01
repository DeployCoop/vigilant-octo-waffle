import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runK3sCisAudit, getK3sHealthScore } from '../k3s-admin.js';
import { findProjectRoot } from '../config.js';

describe('K3s Admin & Health Watchdog', () => {
  const projectRoot = findProjectRoot();

  it('runs CIS audit without crashing and emits structured findings', async () => {
    const report = await runK3sCisAudit(projectRoot);
    assert.ok(report);
    assert.ok(typeof report.scorePercentage === 'number');
    assert.ok(Array.isArray(report.findings));
    assert.ok(report.totalChecks >= 3);
  });

  it('evaluates health score safely even when cluster is offline', async () => {
    const health = await getK3sHealthScore(projectRoot);
    assert.ok(health);
    assert.ok(typeof health.score === 'number');
    assert.ok(['OPTIMAL', 'HEALTHY', 'DEGRADED', 'CRITICAL', 'OFFLINE'].includes(health.grade));
    assert.ok(Array.isArray(health.recommendations));
  });
});
