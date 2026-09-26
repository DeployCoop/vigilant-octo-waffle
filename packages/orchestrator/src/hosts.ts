import * as fs from 'node:fs';

export const DEFAULT_SUBDOMAINS = [
  '',
  'airflow',
  'alertmanager',
  'api-airflow',
  'ar80-mosquitto',
  'argocd',
  'bao',
  'baoui',
  'collabora',
  'cvat',
  'drupal',
  'flower-airflow',
  'fluent-bit',
  'fluentd',
  'fossbilling',
  'grafana',
  'harbor',
  'keycloak',
  'kubeshark',
  'lab',
  'ltb',
  'mariadb-operator',
  'mariadb-operator-crds',
  'master.seaweedfs',
  'minio',
  'minio-api',
  'minio-console',
  'mosquitto',
  'nextcloud',
  'nextjsdocker',
  'opencti',
  'openebs-monitoring',
  'openproject',
  'opensearch',
  'opensearch-dashboards',
  'opentelemetry',
  'pgbounder-airflow',
  'phpldapadmin',
  'pipe',
  'prometheus',
  'rancher',
  'resourcespace',
  'rook-ceph-prod-cluster',
  'rook-ceph-test-cluster',
  'rook-ceph-tools',
  'seaweedfs',
  'sloth',
  'spegel',
  'statsd-airflow',
  'supa',
  'traefik',
  'trino',
  'urban-mosquitto',
  'vigil',
];

export function getFullHostnames(domain: string): string[] {
  return DEFAULT_SUBDOMAINS.map((sub) => (sub ? `${sub}.${domain}` : domain));
}

/**
 * Generates /etc/hosts formatted string
 */
export function generateHostsBlock(domain: string, ip = '127.0.0.1'): string {
  const lines = getFullHostnames(domain).map((host) => `${ip} ${host}`);
  return lines.join('\n');
}

/**
 * Generates BIND DNS zone records (A records)
 */
export function generateBindRecords(domain: string, targetIps: string[]): string {
  const blocks: string[] = [];
  const subdomains = DEFAULT_SUBDOMAINS.filter((s) => s.length > 0);

  for (const ip of targetIps) {
    for (const sub of subdomains) {
      blocks.push(`${sub.padEnd(28)} 14400   IN      A       ${ip}`);
    }
  }

  return blocks.join('\n');
}

/**
 * Generates Cloudflare DNS zone records (A records with proxied flag)
 */
export function generateCloudflareRecords(domain: string, targetIps: string[]): string {
  const blocks: string[] = [];
  const subdomains = DEFAULT_SUBDOMAINS.filter((s) => s.length > 0);

  for (const ip of targetIps) {
    for (const sub of subdomains) {
      blocks.push(`${sub.padEnd(28)} 1       IN      A       ${ip} ; cf_tags=cf-proxied:false`);
    }
  }

  return blocks.join('\n');
}

/**
 * Checks if the current local /etc/hosts file includes the domain
 */
export function checkEtcHosts(domain: string): {
  isConfigured: boolean;
  missingCount: number;
  totalCount: number;
} {
  try {
    if (!fs.existsSync('/etc/hosts')) {
      return { isConfigured: false, missingCount: DEFAULT_SUBDOMAINS.length, totalCount: DEFAULT_SUBDOMAINS.length };
    }
    const content = fs.readFileSync('/etc/hosts', 'utf-8');
    const allHosts = getFullHostnames(domain);
    let missing = 0;

    for (const h of allHosts) {
      if (!content.includes(h)) {
        missing++;
      }
    }

    return {
      isConfigured: missing === 0,
      missingCount: missing,
      totalCount: allHosts.length,
    };
  } catch {
    return { isConfigured: false, missingCount: DEFAULT_SUBDOMAINS.length, totalCount: DEFAULT_SUBDOMAINS.length };
  }
}
