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

export const DEFAULT_EXTRA_DOMAINS: string[] = [];

export type DnsMode = 'sslip' | 'nip' | 'hosts' | 'custom';

/**
 * Returns wildcard domain (e.g. 127.0.0.1.sslip.io or 127.0.0.1.nip.io)
 */
export function getWildcardDomain(mode: 'sslip' | 'nip' = 'sslip', ip = '127.0.0.1'): string {
  return `${ip}.${mode}.io`;
}

/**
 * Formats a subdomain for a given domain and mode
 */
export function formatIngressHostname(
  subdomain: string,
  domain: string,
  mode: DnsMode = 'hosts',
  ip = '127.0.0.1'
): string {
  if (mode === 'sslip' || mode === 'nip') {
    const base = getWildcardDomain(mode, ip);
    return subdomain ? `${subdomain}.${base}` : base;
  }
  return subdomain ? `${subdomain}.${domain}` : domain;
}

export function getFullHostnames(
  domain: string,
  extraDomains: string[] = DEFAULT_EXTRA_DOMAINS
): string[] {
  const standard = DEFAULT_SUBDOMAINS.map((sub) => (sub ? `${sub}.${domain}` : domain));
  const seen = new Set(standard);
  const combined = [...standard];

  for (const extra of extraDomains) {
    if (extra && !seen.has(extra)) {
      seen.add(extra);
      combined.push(extra);
    }
  }

  return combined;
}

/**
 * Generates /etc/hosts formatted string including cluster domain and ecosystem portals
 */
export function generateHostsBlock(
  domain: string,
  ip = '127.0.0.1',
  extraDomains: string[] = DEFAULT_EXTRA_DOMAINS
): string {
  const lines = getFullHostnames(domain, extraDomains).map((host) => `${ip} ${host}`);
  return lines.join('\n');
}

/**
 * Generates BIND DNS zone records (A records)
 */
export function generateBindRecords(
  domain: string,
  targetIps: string[],
  extraDomains: string[] = DEFAULT_EXTRA_DOMAINS
): string {
  const blocks: string[] = [];
  const subdomains = DEFAULT_SUBDOMAINS.filter((s) => s.length > 0);

  for (const ip of targetIps) {
    for (const sub of subdomains) {
      blocks.push(`${sub.padEnd(28)} 14400   IN      A       ${ip}`);
    }
    for (const extra of extraDomains) {
      blocks.push(`${extra.padEnd(28)} 14400   IN      A       ${ip}`);
    }
  }

  return blocks.join('\n');
}

/**
 * Generates Cloudflare DNS zone records (A records with proxied flag)
 */
export function generateCloudflareRecords(
  domain: string,
  targetIps: string[],
  extraDomains: string[] = DEFAULT_EXTRA_DOMAINS
): string {
  const blocks: string[] = [];
  const subdomains = DEFAULT_SUBDOMAINS.filter((s) => s.length > 0);

  for (const ip of targetIps) {
    for (const sub of subdomains) {
      blocks.push(`${sub.padEnd(28)} 1       IN      A       ${ip} ; cf_tags=cf-proxied:false`);
    }
    for (const extra of extraDomains) {
      blocks.push(`${extra.padEnd(28)} 1       IN      A       ${ip} ; cf_tags=cf-proxied:false`);
    }
  }

  return blocks.join('\n');
}

/**
 * Generates CoreDNS Corefile snippet for fully offline wildcard DNS
 */
export function generateCoreDnsConfig(domain = 'example.com', ip = '127.0.0.1'): string {
  return `.:53 {
    forward . 8.8.8.8 1.1.1.1
    template IN A ${domain} {
        match .*\\.${domain.replace('.', '\\.')}
        answer "{{ .Name }} 60 IN A ${ip}"
        fallthrough
    }
    log
    errors
}`;
}

/**
 * Checks if the current local /etc/hosts file includes the domain
 */
export function checkEtcHosts(
  domain: string,
  extraDomains: string[] = DEFAULT_EXTRA_DOMAINS
): {
  isConfigured: boolean;
  missingCount: number;
  totalCount: number;
} {
  const allHosts = getFullHostnames(domain, extraDomains);
  try {
    if (!fs.existsSync('/etc/hosts')) {
      return { isConfigured: false, missingCount: allHosts.length, totalCount: allHosts.length };
    }
    const content = fs.readFileSync('/etc/hosts', 'utf-8');
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
    return { isConfigured: false, missingCount: allHosts.length, totalCount: allHosts.length };
  }
}
