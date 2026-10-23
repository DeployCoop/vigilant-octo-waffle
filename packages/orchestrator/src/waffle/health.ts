/**
 * Waffle step health verification (Plan III §7.3 split of
 * waffle/runner.ts). Behavior-preserving file motion only — WaffleRunner
 * delegates to this function with the per-step log.
 */
import { execFileAsync } from '../exec-argv.js';
import { getWaffleExecutionEnv, errMessage, debug, type WaffleLogFn } from './shared.js';
import { type WaffleStep } from './schema.js';

/**
 * Verifies health of deployed resources
 */
export async function verifyStepHealth(step: WaffleStep, namespace: string, log: WaffleLogFn): Promise<void> {
  const health = step.healthCheck;
  if (!health) {
    // Default health check: wait for pods in namespace with app label
    try {
      await execFileAsync(
        'kubectl',
        ['rollout', 'status', `deployment/${step.releaseName || step.id}`, '-n', namespace, '--timeout=60s'],
        { env: getWaffleExecutionEnv() }
      );
      log('Deployment rollout status confirmed ready.');
    } catch (err) {
      // Rollout status is optional if chart has no matching single deployment name.
      // A genuinely unready deployment is indistinguishable from that case
      // here, so leave a debug trace (§5.7).
      debug(`verifyStepHealth: rollout status for deployment/${step.releaseName || step.id} in namespace "${namespace}" failed: ${errMessage(err)}`);
    }
    return;
  }

  if (health.type === 'storageClass' && health.name) {
    log(`Checking StorageClass: "${health.name}"...`);
    await execFileAsync('kubectl', ['get', 'sc', health.name], { env: getWaffleExecutionEnv() });
    log(`StorageClass "${health.name}" is verified.`);
  } else if (health.type === 'podReady') {
    const releaseName = step.releaseName || step.id;
    log(`Waiting for pods associated with release "${releaseName}"...`);
    try {
      await execFileAsync(
        'kubectl',
        ['wait', '--for=condition=ready', 'pod', '-l', `app.kubernetes.io/instance=${releaseName}`, '-n', namespace, `--timeout=${health.timeout || '2m'}`],
        { env: getWaffleExecutionEnv() }
      );
      log('Pod readiness verified.');
    } catch {
      log('Warning: Pod readiness wait timed out or matched no pods; proceeding.');
    }
  }
}
