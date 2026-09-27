import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface HelmReleaseInfo {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  appVersion: string;
}

export async function listHelmReleases(): Promise<HelmReleaseInfo[]> {
  try {
    const { stdout } = await execAsync('helm list -A -o json');
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      name: item.name || '',
      namespace: item.namespace || '',
      revision: String(item.revision || '1'),
      updated: item.updated || '',
      status: item.status || 'unknown',
      chart: item.chart || '',
      appVersion: item.app_version || '',
    }));
  } catch {
    // If helm is not installed or cluster has no helm releases
    return [];
  }
}

export async function getHelmReleaseValues(name: string, namespace: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`helm get values ${JSON.stringify(name)} -n ${JSON.stringify(namespace)} -a`);
    return stdout;
  } catch (err: any) {
    return `# Failed to retrieve values: ${err.message}`;
  }
}
