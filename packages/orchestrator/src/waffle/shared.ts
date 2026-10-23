/**
 * Shared helpers for the waffle modules: subprocess execution + the execution environment (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 * Plan III PR-15 adds the log-sink type, the error-message helper, and the
 * env-gated debug channel (§5.7) shared by the modules split out of runner.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export const execAsync = promisify(exec);

export function getWaffleExecutionEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kubeconfig =
    process.env.KUBECONFIG ||
    (fs.existsSync('/etc/rancher/k3s/k3s.yaml')
      ? '/etc/rancher/k3s/k3s.yaml'
      : fs.existsSync(path.join(process.env.HOME || '/root', '.kube', 'config'))
      ? path.join(process.env.HOME || '/root', '.kube', 'config')
      : undefined);

  return {
    ...process.env,
    ...(kubeconfig ? { KUBECONFIG: kubeconfig } : {}),
    ...extra,
  };
}

/** Sink for run/user-visible log lines inside the waffle modules. */
export type WaffleLogFn = (message: string) => void;

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

