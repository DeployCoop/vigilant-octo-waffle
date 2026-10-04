/**
 * Shared helpers for the k3s modules (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runSilentJsonQuery<T>(cmd: string, args: string[], cwd: string, fallback: T): Promise<T> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    const jsonMatch = (stdout || '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }
  } catch (err: any) {
    if (err && typeof err.stdout === 'string') {
      const jsonMatch = err.stdout.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {}
      }
    }
  }
  return fallback;
}
