/**
 * Shared helpers for the k3s modules (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Extracts the first parseable JSON value from command output. The old
 * implementation regex-matched greedily from the first '{' to the LAST
 * '}', over-capturing when the output contained trailing braces (log
 * lines, a second JSON document) and failing the parse. This scans
 * candidate end positions until one parses.
 */
function extractJson<T>(text: string): T | undefined {
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  for (let end = text.lastIndexOf(close); end > start; end = text.lastIndexOf(close, end - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      // keep scanning for a shorter candidate
    }
  }
  return undefined;
}

export async function runSilentJsonQuery<T>(cmd: string, args: string[], cwd: string, fallback: T): Promise<T> {
  try {
    // Was the only k3s helper without a timeout: a hung kubectl blocked
    // the caller forever.
    const { stdout } = await execFileAsync(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
    const parsed = extractJson<T>(stdout || '');
    if (parsed !== undefined) return parsed;
  } catch (err) {
    // A failed command may still have printed the JSON payload to stdout
    // before exiting non-zero; the rejection carries it as a property.
    if (err && typeof err === 'object' && 'stdout' in err && typeof err.stdout === 'string') {
      const parsed = extractJson<T>(err.stdout);
      if (parsed !== undefined) return parsed;
    }
  }
  return fallback;
}
