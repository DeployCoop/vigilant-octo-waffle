import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SecretItem {
  key: string;
  value: string;
  base64: string;
}

export function generateRandomSecret(length = 24, charset = 'alphanumeric'): string {
  const chars =
    charset === 'alphanumeric'
      ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';

  const randomBytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

export function toBase64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

export interface GeneratedSecrets {
  secretName: string;
  namespace: string;
  items: Record<string, string>; // raw plaintext
  secretYaml: string;
  keyYaml?: string;
}

/**
 * Generates all cluster secrets matching the keys in src/secrets.sh
 */
export function generateClusterSecrets(options: {
  secretName?: string;
  namespace?: string;
  domainName?: string;
  enablePlainSecrets?: boolean;
}): GeneratedSecrets {
  const secretName = options.secretName || 'cluster-secrets';
  const namespace = options.namespace || 'default';
  const domain = options.domainName || 'example.com';

  const items: Record<string, string> = {
    'argocdadmin-password': generateRandomSecret(31),
    'collabora-username': 'collabadmin',
    'collabora-password': generateRandomSecret(24),
    'db-admin-pass': generateRandomSecret(24),
    'nc-db-password': generateRandomSecret(24),
    'nc-db-hostname': `${namespace}-postgres:5432`,
    'nc-db-name': `${namespace}ncdb`,
    'nc-db-username': `${namespace}nc`,
    'nextcloud-username': 'ncadmin',
    'nextcloud-password': generateRandomSecret(24),
    'nextcloud-token': generateRandomSecret(32),
    'op-db-password': generateRandomSecret(24),
    'airflow-db-password': generateRandomSecret(24),
    'redis-pass': generateRandomSecret(24),
    'replicationUserPassword': generateRandomSecret(24),
    'smtp-username': `mailadmin@${domain}`,
    'smtp-password': generateRandomSecret(24),
    'smtp-host': `mail.${domain}`,
    'HARBOR_ADMIN_PASSWORD': generateRandomSecret(16),
    'OPENSEARCH_INITIAL_ADMIN_PASSWORD': `${generateRandomSecret(18)}Aa1!`,
  };

  // Build Kubernetes Secret YAML (with base64 data)
  let secretYaml = `apiVersion: v1
kind: Secret
metadata:
  name: ${secretName}
  namespace: ${namespace}
type: Opaque
data:
`;

  for (const [k, v] of Object.entries(items)) {
    secretYaml += `  ${k}: ${toBase64(v)}\n`;
  }

  let keyYaml: string | undefined;
  if (options.enablePlainSecrets) {
    keyYaml = `apiVersion: v1
kind: Secret
metadata:
  name: ${secretName}
  namespace: ${namespace}
type: Opaque
stringData:
`;
    for (const [k, v] of Object.entries(items)) {
      keyYaml += `  ${k}: "${v}"\n`;
    }
  }

  return {
    secretName,
    namespace,
    items,
    secretYaml,
    keyYaml,
  };
}

/**
 * Saves secrets to disk in .secrets/ directory
 */
export function saveClusterSecrets(
  secretsDir: string,
  secrets: GeneratedSecrets,
  plainKeyFileName?: string
): { secretPath: string; keyPath?: string } {
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true });
  }

  const secretPath = path.join(secretsDir, `${secrets.secretName}.yaml`);
  fs.writeFileSync(secretPath, secrets.secretYaml, 'utf-8');

  let keyPath: string | undefined;
  if (secrets.keyYaml && plainKeyFileName) {
    keyPath = path.join(secretsDir, plainKeyFileName);
    fs.writeFileSync(keyPath, secrets.keyYaml, 'utf-8');
  }

  return { secretPath, keyPath };
}

export interface SecretVaultItem {
  key: string;
  category: 'Admin Passwords' | 'Databases' | 'Tokens & Keys' | 'SMTP & Mail';
  targetApp: string;
  kubernetesSecret: string;
  namespace: string;
  value: string;
  masked: string;
  loginSubdomain?: string;
}

/**
 * Reads existing generated secrets or generates them dynamically, and maps them to apps
 */
export function listClusterSecrets(projectRoot: string, domain = '127.0.0.1.sslip.io'): SecretVaultItem[] {
  const secretsDir = path.join(projectRoot, '.secrets');
  const secretYamlPath = path.join(secretsDir, 'cluster-secrets.yaml');

  let items: Record<string, string> = {};

  if (fs.existsSync(secretYamlPath)) {
    try {
      const content = fs.readFileSync(secretYamlPath, 'utf-8');
      // Read data: key: base64
      const lines = content.split('\n');
      let inData = false;
      for (const line of lines) {
        if (line.trim() === 'data:') {
          inData = true;
          continue;
        }
        if (inData && line.startsWith('  ') && line.includes(':')) {
          const parts = line.trim().split(':');
          const k = parts[0].trim();
          const b64 = parts[1].trim();
          items[k] = Buffer.from(b64, 'base64').toString('utf-8');
        } else if (inData && !line.startsWith('  ') && line.trim()) {
          inData = false;
        }
      }
    } catch {
      // fallback
    }
  }

  // If no secrets generated yet, provide default template
  if (Object.keys(items).length === 0) {
    const generated = generateClusterSecrets({ domainName: domain });
    items = generated.items;
  }

  const appMappings: Record<string, { app: string; category: SecretVaultItem['category']; sub?: string }> = {
    'argocdadmin-password': { app: 'ArgoCD', category: 'Admin Passwords', sub: 'argocd' },
    'collabora-username': { app: 'Collabora Office', category: 'Admin Passwords', sub: 'collabora' },
    'collabora-password': { app: 'Collabora Office', category: 'Admin Passwords', sub: 'collabora' },
    'db-admin-pass': { app: 'PostgreSQL Root', category: 'Databases' },
    'nc-db-password': { app: 'Nextcloud DB', category: 'Databases' },
    'nc-db-hostname': { app: 'Nextcloud DB Host', category: 'Databases' },
    'nc-db-name': { app: 'Nextcloud DB Name', category: 'Databases' },
    'nc-db-username': { app: 'Nextcloud DB User', category: 'Databases' },
    'nextcloud-username': { app: 'Nextcloud Admin', category: 'Admin Passwords', sub: 'nextcloud' },
    'nextcloud-password': { app: 'Nextcloud Admin', category: 'Admin Passwords', sub: 'nextcloud' },
    'nextcloud-token': { app: 'Nextcloud Secret Token', category: 'Tokens & Keys' },
    'op-db-password': { app: 'OpenProject DB', category: 'Databases' },
    'airflow-db-password': { app: 'Apache Airflow DB', category: 'Databases' },
    'redis-pass': { app: 'Redis Cache', category: 'Databases' },
    'replicationUserPassword': { app: 'PostgreSQL Replication', category: 'Databases' },
    'smtp-username': { app: 'SMTP Mailer', category: 'SMTP & Mail' },
    'smtp-password': { app: 'SMTP Mailer', category: 'SMTP & Mail' },
    'smtp-host': { app: 'SMTP Mailer Host', category: 'SMTP & Mail' },
    'HARBOR_ADMIN_PASSWORD': { app: 'Harbor Registry', category: 'Admin Passwords', sub: 'harbor' },
    'OPENSEARCH_INITIAL_ADMIN_PASSWORD': { app: 'OpenSearch', category: 'Admin Passwords', sub: 'opensearch' },
  };

  const results: SecretVaultItem[] = [];

  for (const [k, v] of Object.entries(items)) {
    const meta = appMappings[k] || { app: 'Cluster', category: 'Tokens & Keys' };
    const masked = v.length > 4 ? `${v.substring(0, 2)}${'•'.repeat(Math.min(16, v.length - 4))}${v.substring(v.length - 2)}` : '••••••••';

    results.push({
      key: k,
      category: meta.category,
      targetApp: meta.app,
      kubernetesSecret: 'cluster-secrets',
      namespace: 'default',
      value: v,
      masked,
      loginSubdomain: meta.sub,
    });
  }

  return results;
}

