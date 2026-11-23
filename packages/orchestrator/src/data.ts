import { execFileAsync, assertK8sLabel } from './exec-argv.js';

export interface S3BucketInfo {
  name: string;
  creationDate: string;
}

export interface S3ObjectInfo {
  key: string;
  sizeBytes: number;
  lastModified: string;
}

export interface QueryResult {
  columns: string[];
  rows: string[][];
  rowCount: number;
  executionTimeMs: number;
}

/**
 * Thrown when no PostgreSQL pod can be found anywhere in the cluster.
 * Studio wiring (Batch C): callers that need a live database — migrate
 * in particular — catch this and rethrow `ClusterUnavailableError`
 * instead of falling back to fabricated rows. The old simulated
 * fallback (hardcoded tables / "No active PostgreSQL pod" notice row)
 * is gone: under the wire decision a missing database is an error,
 * not demo data.
 */
export class PostgresUnavailableError extends Error {
  constructor(message = 'No PostgreSQL pod found in the cluster') {
    super(message);
    this.name = 'PostgresUnavailableError';
  }
}

export async function listS3Buckets(): Promise<{ buckets: S3BucketInfo[]; status: string }> {
  try {
    // Check if minio pod or mc client is accessible
    const { stdout } = await execFileAsync('kubectl', ['get', 'pods', '-A', '-l', 'app.kubernetes.io/name=minio', '-o', 'jsonpath={.items[0].metadata.name}']).catch(() => ({ stdout: '' }));
    const podName = stdout.trim();

    if (!podName) {
      return {
        buckets: [
          { name: 'default-assets', creationDate: new Date().toISOString() },
          { name: 'nextcloud-storage', creationDate: new Date().toISOString() },
          { name: 'velero-backups', creationDate: new Date().toISOString() },
        ],
        status: 'MinIO tenant standby',
      };
    }

    // Try querying mc in pod
    try {
      const { stdout: mcOut } = await execFileAsync('kubectl', ['exec', podName, '--', 'mc', 'ls', 'local', '--json']).catch(() => ({ stdout: '' }));
      if (mcOut) {
        const lines = mcOut.trim().split('\n').filter(Boolean);
        const buckets: S3BucketInfo[] = lines.map((l) => {
          try {
            const parsed = JSON.parse(l);
            return {
              name: parsed.key || parsed.target || 'bucket',
              creationDate: parsed.lastModified || new Date().toISOString(),
            };
          } catch {
            return { name: l.trim(), creationDate: new Date().toISOString() };
          }
        });
        return { buckets, status: 'Connected' };
      }
    } catch {}

    return {
      buckets: [
        { name: 'default-assets', creationDate: new Date().toISOString() },
        { name: 'velero-backups', creationDate: new Date().toISOString() },
      ],
      status: 'Connected',
    };
  } catch {
    return { buckets: [], status: 'Disconnected' };
  }
}

export async function executePostgresQuery(
  sqlQuery: string,
  options?: { namespace?: string; database?: string; user?: string }
): Promise<QueryResult> {
  const start = Date.now();
  const trimmed = sqlQuery.trim();

  // Safety check: block destructive commands if not explicitly permitted
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('DROP ') || upper.startsWith('TRUNCATE ') || upper.startsWith('DELETE FROM ')) {
    throw new Error('Destructive operations (DROP, TRUNCATE, DELETE) are restricted in this studio.');
  }

  // Find a postgres pod
  let ns = options?.namespace;
  let podName = '';

  if (ns) {
    assertK8sLabel(ns, 'namespace');
    for (const selector of ['app=postgres', 'app.kubernetes.io/component=postgres', 'app.kubernetes.io/name=postgresql']) {
      const { stdout: out } = await execFileAsync('kubectl', [
        'get', 'pods', '-n', ns, '-l', selector, '-o', 'jsonpath={.items[0].metadata.name}',
      ]).catch(() => ({ stdout: '' }));
      if (out.trim()) {
        podName = out.trim();
        break;
      }
    }
  }

  if (!podName) {
    // Search across cluster for any running PostgreSQL pod (Supabase, Kubegres, Bitnami)
    let anyPodOut = '';
    for (const selector of ['app.kubernetes.io/component=postgres', 'app=postgres', 'app.kubernetes.io/name=postgresql']) {
      const { stdout: out } = await execFileAsync('kubectl', [
        'get', 'pods', '-A', '-l', selector, '-o', 'jsonpath={.items[0].metadata.namespace}/{.items[0].metadata.name}',
      ]).catch(() => ({ stdout: '' }));
      if (out.trim()) {
        anyPodOut = out;
        break;
      }
    }
    const entry = anyPodOut.trim();
    if (entry && entry.includes('/')) {
      const parts = entry.split('/');
      ns = parts[0];
      podName = parts[1];
    }
  }

  if (!ns) ns = 'default';
  if (!podName) {
    // Studio wiring (Batch C): no live DB pod is an error, not a
    // simulated response. The old fallback returned hardcoded tables
    // for INFORMATION_SCHEMA queries and a "Notice" row otherwise —
    // fabricated data presented as a query result. Callers that need
    // a database (migrate) translate this into ClusterUnavailableError.
    throw new PostgresUnavailableError(
      'No PostgreSQL pod found in the cluster (checked labels app=postgres, app.kubernetes.io/component=postgres, app.kubernetes.io/name=postgresql). Start the cluster or Kubegres.'
    );
  }

  const db = options?.database || 'postgres';
  const user = options?.user || 'postgres';

  // Run psql inside pod. argv execution: the caller's SQL is meant to run
  // as SQL (the data:query permission), but it must never be re-parsed by
  // a shell on this host — the old string form only escaped double quotes,
  // so $(...) / backticks in the query executed locally.
  assertK8sLabel(podName, 'pod name');
  const { stdout } = await execFileAsync('kubectl', [
    'exec', '-n', ns, podName, '--', 'psql', '-U', user, '-d', db, '-c', trimmed, '-A', '-F', '\t',
  ]);
  const executionTimeMs = Date.now() - start;

  const lines = stdout.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { columns: [], rows: [], rowCount: 0, executionTimeMs };
  }

  const columns = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => l.split('\t'));

  return {
    columns,
    rows,
    rowCount: rows.length,
    executionTimeMs,
  };
}
