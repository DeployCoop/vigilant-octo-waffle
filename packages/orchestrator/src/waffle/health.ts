/**
 * Waffle step health verification (Plan III §7.3 split of
 * waffle/runner.ts). Behavior-preserving file motion only — WaffleRunner
 * delegates to this function with the per-step log.
 */
import { processManager, assertCommandSuccess } from '../executor.js';
import { getWaffleExecutionEnv, debug, type WaffleLogFn } from './shared.js';
import { type WaffleStep } from './schema.js';

/**
 * Verifies health of deployed resources.
 *
 * Q8: kubectl runs through the task executor (validator + task log)
 * instead of execFileAsync, which bypassed both. `cwd` is the
 * pipeline base directory when the runner knows it (task-store
 * auto-attach); it defaults to the process cwd for direct callers.
 */
export async function verifyStepHealth(
  step: WaffleStep,
  namespace: string,
  log: WaffleLogFn,
  cwd: string = process.cwd()
): Promise<void> {
  const health = step.healthCheck;
  if (!health) {
    // Default health check: wait for pods in namespace with app label
    const rollout = await processManager.runCommandAndWait(
      'kubectl',
      ['rollout', 'status', `deployment/${step.releaseName || step.id}`, '-n', namespace, '--timeout=60s'],
      { cwd, env: getWaffleExecutionEnv() }
    );
    if (rollout.code === 0) {
      log('Deployment rollout status confirmed ready.');
    } else {
      // Rollout status is optional if chart has no matching single deployment name.
      // A genuinely unready deployment is indistinguishable from that case
      // here, so leave a debug trace (§5.7).
      debug(
        `verifyStepHealth: rollout status for deployment/${step.releaseName || step.id} in namespace "${namespace}" failed: ${rollout.stderr.trim() || `exit code ${rollout.code}`}`
      );
    }
    return;
  }

  if (health.type === 'storageClass' && health.name) {
    log(`Checking StorageClass: "${health.name}"...`);
    const sc = await processManager.runCommandAndWait(
      'kubectl',
      ['get', 'sc', health.name],
      { cwd, env: getWaffleExecutionEnv() }
    );
    assertCommandSuccess(sc, `kubectl get sc ${health.name}`);
    log(`StorageClass "${health.name}" is verified.`);
  } else if (health.type === 'podReady') {
    const releaseName = step.releaseName || step.id;
    log(`Waiting for pods associated with release "${releaseName}"...`);
    const wait = await processManager.runCommandAndWait(
      'kubectl',
      ['wait', '--for=condition=ready', 'pod', '-l', `app.kubernetes.io/instance=${releaseName}`, '-n', namespace, `--timeout=${health.timeout || '2m'}`],
      { cwd, env: getWaffleExecutionEnv() }
    );
    if (wait.code === 0) {
      log('Pod readiness verified.');
    } else {
      log('Warning: Pod readiness wait timed out or matched no pods; proceeding.');
    }
  }
}
