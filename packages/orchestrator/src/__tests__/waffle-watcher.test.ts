import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  WaffleWatcher,
  findProjectRoot,
} from '../index.js';

describe('WaffleWatcher Engine Tests', () => {
  const projectRoot = findProjectRoot();

  it('initializes with default options and resolves project root', () => {
    const watcher = new WaffleWatcher({
      projectRoot,
      dryRun: true,
    });

    assert.equal(watcher.isRunning(), false);
    assert.equal(watcher.getTargets().length, 0);
  });

  it('filters targets when targetFilter is specified', async () => {
    // Create a temporary pipeline
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waffle-watcher-test-'));
    const pipelineFile = path.join(tmpDir, 'waffle.yaml');

    const sampleYaml = `
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: test-pipeline
builds:
  registry: "localhost:5001"
  targets:
    - name: app-alpha
      context: ./alpha
      image: test/alpha
      tag: "1.0.0"
    - name: app-beta
      context: ./beta
      image: test/beta
      tag: "2.0.0"
stages:
  - id: 00-apps
    name: Apps
    steps:
      - id: app-alpha
        name: App Alpha
        chart: ./charts/alpha
      - id: app-beta
        name: App Beta
        chart: ./charts/beta
`;
    fs.writeFileSync(pipelineFile, sampleYaml, 'utf8');

    // Create directories
    fs.mkdirSync(path.join(tmpDir, 'alpha'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'beta'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'charts', 'alpha'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'charts', 'beta'), { recursive: true });

    try {
      const watcher = new WaffleWatcher({
        projectRoot: tmpDir,
        pipelinePath: pipelineFile,
        targets: ['app-alpha'],
        dryRun: true,
      });

      await watcher.init();

      const targets = watcher.getTargets();
      assert.equal(targets.length, 1);
      assert.ok(watcher.hasTarget('app-alpha'));
      assert.equal(watcher.hasTarget('app-beta'), false);

      const alpha = watcher.getTarget('app-alpha')!;
      assert.equal(alpha.image, 'test/alpha');
      assert.equal(alpha.tag, '1.0.0');
      assert.equal(alpha.context, path.join(tmpDir, 'alpha'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs checkOnce in dry-run mode and emits check_complete event', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waffle-watcher-check-'));
    const pipelineFile = path.join(tmpDir, 'waffle.yaml');

    const sampleYaml = `
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: test-check
builds:
  registry: "localhost:5001"
  targets:
    - name: svc-one
      context: ./svc-one
      image: test/svc-one
      tag: latest
stages:
  - id: 00-main
    name: Main
    steps:
      - id: svc-one
        name: Svc One
        chart: ./charts/svc-one
`;
    fs.writeFileSync(pipelineFile, sampleYaml, 'utf8');
    const svcDir = path.join(tmpDir, 'svc-one');
    fs.mkdirSync(svcDir, { recursive: true });
    fs.writeFileSync(path.join(svcDir, 'index.js'), 'console.log("hello");');
    fs.mkdirSync(path.join(tmpDir, 'charts', 'svc-one'), { recursive: true });

    try {
      let eventFired = false;
      const watcher = new WaffleWatcher({
        projectRoot: tmpDir,
        pipelinePath: pipelineFile,
        dryRun: true,
        logger: () => {},
      });

      watcher.on('ready', (res) => {
        eventFired = true;
        assert.equal(res.targetsCount, 1);
      });

      const result = await watcher.checkOnce();
      assert.ok(eventFired);
      assert.equal(result.targetsChecked, 1);
      // On initial check, baseline SHA/mtime is set, changesDetected is 0
      assert.equal(result.changesDetected, 0);
      assert.equal(result.rebuilds.length, 0);

      // Mutate a file in the context with updated mtime in the future to ensure detection
      const newTime = (Date.now() + 2000) / 1000;
      fs.writeFileSync(path.join(svcDir, 'index.js'), 'console.log("updated");');
      fs.utimesSync(path.join(svcDir, 'index.js'), newTime, newTime);
      fs.utimesSync(svcDir, newTime, newTime);

      // Now check again: mtime change should be detected
      const result2 = await watcher.checkOnce();
      assert.equal(result2.changesDetected, 1);
      assert.equal(result2.rebuilds.length, 1);
      assert.equal(result2.rebuilds[0].target, 'svc-one');
      assert.equal(result2.rebuilds[0].image, 'localhost:5001/test/svc-one:latest');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('synchronizes repo chart templates to central chart dir when present', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waffle-sync-test-'));
    const pipelineFile = path.join(tmpDir, 'waffle.yaml');

    // Create context repo with helm/ subdirectory
    const repoDir = path.join(tmpDir, 'service-repo');
    const repoHelmDir = path.join(repoDir, 'helm', 'my-chart');
    const repoTemplatesDir = path.join(repoHelmDir, 'templates');
    fs.mkdirSync(repoTemplatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoHelmDir, 'Chart.yaml'),
      'name: my-chart\nversion: 0.1.0\n'
    );
    fs.writeFileSync(
      path.join(repoTemplatesDir, 'deployment.yaml'),
      '# deployment template from repo\n'
    );

    // Central charts directory
    const centralChartDir = path.join(tmpDir, 'charts', 'my-chart');
    fs.mkdirSync(centralChartDir, { recursive: true });

    const sampleYaml = `
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: sync-test
builds:
  registry: "localhost:5001"
  targets:
    - name: my-chart
      context: ./service-repo
      image: test/my-chart
      tag: latest
stages:
  - id: 00-main
    name: Main
    steps:
      - id: my-chart
        name: My Chart
        chart: ./charts/my-chart
`;
    fs.writeFileSync(pipelineFile, sampleYaml, 'utf8');

    try {
      const watcher = new WaffleWatcher({
        projectRoot: tmpDir,
        pipelinePath: pipelineFile,
        dryRun: true,
        syncCharts: true,
        logger: () => {},
      });

      await watcher.init();

      const target = watcher.getTarget('my-chart');
      assert.ok(target);
      assert.equal(target.repoChartPath, repoHelmDir);

      // Verify template sync
      const synced = await watcher.syncRepoChartToCentral(target);
      assert.equal(synced, true);

      // Central chart should now have deployment.yaml and Chart.yaml
      const centralDeployment = path.join(centralChartDir, 'templates', 'deployment.yaml');
      assert.ok(fs.existsSync(centralDeployment));
      assert.equal(
        fs.readFileSync(centralDeployment, 'utf8'),
        '# deployment template from repo\n'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves real charts/waffle.yaml targets if present in system', async () => {
    const waffleFile = '/root/charts/waffle.yaml';
    if (!fs.existsSync(waffleFile)) {
      return;
    }

    const watcher = new WaffleWatcher({
      projectRoot,
      pipelinePath: waffleFile,
      dryRun: true,
      logger: () => {},
    });

    await watcher.init();
    const targets = watcher.getTargets();
    assert.ok(targets.length > 0);

    // Check known targets from waffle.yaml
    for (const name of ['billama', 'bokbot', 'fitdjinn', 'monitaur']) {
      if (watcher.hasTarget(name)) {
        const t = watcher.getTarget(name)!;
        assert.ok(t.context, `Target ${name} should have a context path`);
        assert.ok(t.image, `Target ${name} should have an image name`);
        assert.ok(t.tag, `Target ${name} should have a tag`);
      }
    }
  });
});
