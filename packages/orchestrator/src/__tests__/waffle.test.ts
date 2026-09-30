import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  parseWaffleYaml,
  loadWafflePipeline,
  validateWafflePipeline,
  WaffleSourceManager,
  WaffleRunner,
  WaffleRunHistory,
  BUILTIN_BLUEPRINTS,
  getBuiltinBlueprints,
  getBlueprintById,
  type WafflePipeline,
} from '../index.js';

describe('Waffle Meta-Package Engine Tests', () => {
  const sampleValidYaml = `
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: test-stack
  version: 1.2.0
  description: "Test Waffle Stack"
  tags: [test, kubernetes]
settings:
  defaultNamespace: test-ns
  defaultStorageClass: openebs-hostpath
  rollbackOnFailure: true
preflight:
  storage:
    requireStorageClass: openebs-hostpath
    autoInstallOpenEBS: true
stages:
  - id: 00-storage
    name: "Storage Foundation"
    mode: series
    steps:
      - id: openebs
        name: "OpenEBS LocalPV"
        chart: ./openebs
        namespace: openebs
        wait: true
  - id: 10-apps
    name: "Application Services"
    mode: parallel
    dependsOn: [00-storage]
    steps:
      - id: web-app
        name: "Web Application"
        chart: ./web-app
        domain: test.example.com
        set:
          ingress.host: test.example.com
`;

  it('parses valid waffle.yaml correctly with defaults', () => {
    const pipeline = parseWaffleYaml(sampleValidYaml);
    assert.equal(pipeline.metadata.name, 'test-stack');
    assert.equal(pipeline.metadata.version, '1.2.0');
    assert.equal(pipeline.settings?.defaultNamespace, 'test-ns');
    assert.equal(pipeline.settings?.defaultStorageClass, 'openebs-hostpath');
    assert.equal(pipeline.stages.length, 2);
    assert.equal(pipeline.stages[0].id, '00-storage');
    assert.equal(pipeline.stages[0].mode, 'series');
    assert.equal(pipeline.stages[1].id, '10-apps');
    assert.equal(pipeline.stages[1].mode, 'parallel');
    assert.equal(pipeline.stages[1].steps[0].domain, 'test.example.com');
  });

  it('rejects invalid or empty yaml manifest', () => {
    assert.throws(() => parseWaffleYaml(''), /Invalid Waffle manifest/);
    assert.throws(
      () =>
        parseWaffleYaml(`
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  description: "Missing name property"
stages: []
`),
      /metadata\.name/
    );
  });

  it('validates stage dependencies and unique IDs', () => {
    const validPipeline = parseWaffleYaml(sampleValidYaml);
    const result = validateWafflePipeline(validPipeline);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.stagesCount, 2);
    assert.equal(result.stepsCount, 2);

    // Pipeline with duplicate stage IDs
    const duplicateStages: WafflePipeline = {
      metadata: { name: 'dup-test' },
      stages: [
        {
          id: 'stage-1',
          name: 'Stage 1',
          steps: [{ id: 's1', name: 'Step 1', chart: 'chart1' }],
        },
        {
          id: 'stage-1',
          name: 'Stage 1 Duplicate',
          steps: [{ id: 's2', name: 'Step 2', chart: 'chart2' }],
        },
      ],
    };
    const dupResult = validateWafflePipeline(duplicateStages);
    assert.equal(dupResult.valid, false);
    assert.match(dupResult.errors[0], /Duplicate stage ID/);

    // Pipeline with non-existent dependency reference
    const brokenDep: WafflePipeline = {
      metadata: { name: 'broken-dep' },
      stages: [
        {
          id: 'stage-2',
          name: 'Stage 2',
          dependsOn: ['ghost-stage'],
          steps: [{ id: 's1', name: 'Step 1', chart: 'chart1' }],
        },
      ],
    };
    const depResult = validateWafflePipeline(brokenDep);
    assert.equal(depResult.valid, false);
    assert.match(depResult.errors[0], /references non-existent dependency stage/);
  });

  it('loads and validates all 6 built-in community blueprints', () => {
    const blueprints = getBuiltinBlueprints();
    assert.equal(blueprints.length, 6);

    const expectedNames = [
      'blueprint-nextjs-supabase',
      'blueprint-python-mongodb',
      'blueprint-jupyter-cassandra',
      'blueprint-kctf',
      'blueprint-zero-trust-storage',
      'blueprint-homelab',
    ];

    for (const name of expectedNames) {
      const bp = getBlueprintById(name);
      assert.ok(bp, `Blueprint "${name}" should be found`);
      const val = validateWafflePipeline(bp);
      assert.equal(val.valid, true, `Blueprint "${name}" must pass validation`);
      assert.ok(val.stagesCount >= 3, `Blueprint "${name}" should have >= 3 stages`);
      assert.ok(val.stepsCount >= 3, `Blueprint "${name}" should have >= 3 steps`);
    }
  });

  it('validates canonical ecosystem waffle.yaml in charts directory if present', async () => {
    const chartsWaffle = '/home/thoth/billama/charts/waffle.yaml';
    if (fs.existsSync(chartsWaffle)) {
      const { pipeline } = await loadWafflePipeline('/home/thoth/billama/charts');
      assert.equal(pipeline.metadata.name, 'billama-datacenter-ecosystem');
      const val = validateWafflePipeline(pipeline, '/home/thoth/billama/charts');
      assert.equal(val.valid, true, 'Master ecosystem waffle.yaml should be valid');
      assert.equal(val.stagesCount, 4);
      assert.equal(val.stepsCount, 12);
    }
  });

  it('simulates pipeline execution in dry-run mode via WaffleRunner', async () => {
    const runner = new WaffleRunner(process.cwd());
    const bp = getBlueprintById('blueprint-nextjs-supabase')!;

    const events: string[] = [];
    runner.on('start', () => events.push('start'));
    runner.on('stage_start', (d) => events.push(`stage_start:${d.stageId}`));
    runner.on('step_start', (d) => events.push(`step_start:${d.stepId}`));
    runner.on('step_complete', (d) => events.push(`step_complete:${d.stepId}`));
    runner.on('stage_complete', (d) => events.push(`stage_complete:${d.stageId}`));
    runner.on('finish', () => events.push('finish'));

    const runResult = await runner.executePipeline({
      sourceId: 'blueprint-test',
      pipeline: bp,
      baseDir: process.cwd(),
      dryRun: true,
    });

    assert.equal(runResult.status, 'completed');
    assert.equal(runResult.totalSteps, 3);
    assert.equal(runResult.completedSteps, 3);
    assert.equal(runResult.failedSteps, 0);
    assert.ok(events.includes('start'));
    assert.ok(events.includes('finish'));
    assert.ok(events.includes('stage_start:00-storage-foundation'));
    assert.ok(events.includes('step_start:openebs'));
  });

  it('records and retrieves execution history via WaffleRunHistory', async () => {
    const history = new WaffleRunHistory(process.cwd());
    const runner = new WaffleRunner(process.cwd());
    const bp = getBlueprintById('blueprint-python-mongodb')!;

    const run = await runner.executePipeline({
      sourceId: 'history-test',
      pipeline: bp,
      baseDir: process.cwd(),
      dryRun: true,
    });

    const recorded = await history.getRun(run.runId);
    assert.ok(recorded, 'Run should be recorded in history');
    assert.equal(recorded?.runId, run.runId);
    assert.equal(recorded?.status, 'completed');
  });
});
