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
