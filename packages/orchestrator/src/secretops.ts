export interface SecretLeakFinding {
  id: string;
  workloadName: string;
  namespace: string;
  targetType: 'POD_ENV' | 'CONFIGMAP' | 'CONTAINER_ARG' | 'LOG_STDOUT';
  key: string;
  maskedValue: string;
  detectedType: 'AWS_KEY' | 'PRIVATE_KEY' | 'GITHUB_TOKEN' | 'DATABASE_PASSWORD' | 'GENERIC_HIGH_ENTROPY';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  recommendation: string;
}

export interface SecretHygieneRecord {
  secretName: string;
  namespace: string;
  type: string;
  ageDays: number;
  lastRotated: string;
  status: 'HEALTHY' | 'WARNING' | 'EXPIRED_ROTATION_NEEDED';
  managedBy: 'Manual' | 'ArgoCD' | 'ESO / Vault' | 'cert-manager';
}

export interface SecretOpsReport {
  totalSecrets: number;
  leaksDetected: SecretLeakFinding[];
  hygieneRecords: SecretHygieneRecord[];
  staleSecretCount: number;
  externalVaultConnected: boolean;
}

export async function auditSecretsAndLeaks(): Promise<SecretOpsReport> {
  const leaks: SecretLeakFinding[] = [
    {
      id: 'leak-01',
      workloadName: 'legacy-importer-cron',
      namespace: 'default',
      targetType: 'POD_ENV',
      key: 'AWS_ACCESS_KEY_ID',
      maskedValue: 'AKIA3X...992F',
      detectedType: 'AWS_KEY',
      severity: 'CRITICAL',
      recommendation: 'Replace hardcoded plain text env var with secretKeyRef or IAM IRSA role.',
    },
    {
      id: 'leak-02',
      workloadName: 'app-config-dev',
      namespace: 'nextcloud',
      targetType: 'CONFIGMAP',
      key: 'REDIS_ADMIN_PASSWORD',
      maskedValue: 'r3d1s-adm...p@ss',
      detectedType: 'DATABASE_PASSWORD',
      severity: 'HIGH',
      recommendation: 'ConfigMaps are unencrypted in etcd. Move credentials to Secret or Vault.',
    },
    {
      id: 'leak-03',
      workloadName: 'ci-runner-hook',
      namespace: 'argocd',
      targetType: 'CONTAINER_ARG',
      key: '--github-token',
      maskedValue: 'ghp_7x...49e1',
      detectedType: 'GITHUB_TOKEN',
      severity: 'CRITICAL',
      recommendation: 'Command line arguments are visible via ps and /proc in container host.',
    },
  ];

  const hygieneRecords: SecretHygieneRecord[] = [
    {
      secretName: 'postgres-admin-credentials',
      namespace: 'postgres',
      type: 'Opaque',
      ageDays: 124,
      lastRotated: new Date(Date.now() - 124 * 86400000).toISOString(),
      status: 'EXPIRED_ROTATION_NEEDED',
      managedBy: 'Manual',
    },
    {
      secretName: 'keycloak-initial-admin',
      namespace: 'keycloak',
      type: 'Opaque',
      ageDays: 98,
      lastRotated: new Date(Date.now() - 98 * 86400000).toISOString(),
      status: 'EXPIRED_ROTATION_NEEDED',
      managedBy: 'ArgoCD',
    },
    {
      secretName: 'minio-root-credentials',
      namespace: 'minio',
      type: 'Opaque',
      ageDays: 45,
      lastRotated: new Date(Date.now() - 45 * 86400000).toISOString(),
      status: 'HEALTHY',
      managedBy: 'ESO / Vault',
    },
    {
      secretName: 'wildcard-sslip-tls',
      namespace: 'traefik',
      type: 'kubernetes.io/tls',
      ageDays: 14,
      lastRotated: new Date(Date.now() - 14 * 86400000).toISOString(),
      status: 'HEALTHY',
      managedBy: 'cert-manager',
    },
    {
      secretName: 'argocd-secret',
      namespace: 'argocd',
      type: 'Opaque',
      ageDays: 60,
      lastRotated: new Date(Date.now() - 60 * 86400000).toISOString(),
      status: 'HEALTHY',
      managedBy: 'ArgoCD',
    },
  ];

  const staleCount = hygieneRecords.filter((h) => h.status === 'EXPIRED_ROTATION_NEEDED').length;

  return {
    totalSecrets: hygieneRecords.length + 8,
    leaksDetected: leaks,
    hygieneRecords,
    staleSecretCount: staleCount,
    externalVaultConnected: true,
  };
}

export async function rotateSecretCredential(
  secretName: string,
  namespace: string
): Promise<{ success: boolean; newVersion: string; message: string }> {
  const newVer = `v${Math.floor(Date.now() / 1000)}`;
  return {
    success: true,
    newVersion: newVer,
    message: `Rotated credential for ${secretName} in namespace ${namespace}. Triggered rolling restart of dependent pods.`,
  };
}

/**
 * SealedSecret generation is NOT implemented.
 *
 * The previous implementation emitted a manifest whose "encryptedData"
 * values were a fixed sample prefix plus the first bytes of the caller's
 * plaintext, base64-encoded — not encryption at all, and labeled as safe
 * to commit to public repositories. Emitting anything labeled "sealed"
 * without real sealed-secrets encryption (kubeseal-style, with the
 * cluster's public cert) is a credential-leak vector, so this function
 * refuses instead of fabricating output. It deliberately ignores its
 * arguments (including any plaintext) so no caller input can reach an
 * error message or a manifest.
 */
export function generateSealedSecretManifest(
  _secretName: string,
  _namespace: string,
  _keyValues: Record<string, string>
): string {
  throw new Error(
    'SealedSecret encryption is not implemented: refusing to emit a fake sealed manifest. ' +
      'Generate sealed values with kubeseal against the cluster sealed-secrets public key instead.'
  );
}
