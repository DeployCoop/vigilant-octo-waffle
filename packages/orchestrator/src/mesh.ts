export interface WorkloadIdentity {
  podName: string;
  namespace: string;
  serviceAccount: string;
  spiffeId: string;
  certSerial: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysUntilExpiration: number;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
}

export interface TlsConnectionLink {
  id: string;
  sourceWorkload: string;
  sourceNamespace: string;
  targetWorkload: string;
  targetNamespace: string;
  port: number;
  protocol: string;
  tlsMode: 'STRICT_MTLS' | 'PERMISSIVE_TLS' | 'PLAINTEXT';
  cipherSuite: string;
  latencyMs: number;
}

const strictMtlsNamespaces = new Set<string>(['traefik', 'keycloak']);

export async function scanMeshIdentities(): Promise<WorkloadIdentity[]> {
  return [
    {
      podName: 'traefik-8547568d4-x1',
      namespace: 'traefik',
      serviceAccount: 'traefik-ingress',
      spiffeId: 'spiffe://cluster.local/ns/traefik/sa/traefik-ingress',
      certSerial: '4F:8B:2A:9C:11:7E',
      issuer: 'Cilium / SPIRE Intermediate CA',
      validFrom: new Date(Date.now() - 5 * 86400000).toISOString(),
      validTo: new Date(Date.now() + 85 * 86400000).toISOString(),
      daysUntilExpiration: 85,
      status: 'VALID',
    },
    {
      podName: 'keycloak-0',
      namespace: 'keycloak',
      serviceAccount: 'keycloak-sa',
      spiffeId: 'spiffe://cluster.local/ns/keycloak/sa/keycloak-sa',
      certSerial: '7C:1E:88:AA:03:91',
      issuer: 'Cilium / SPIRE Intermediate CA',
      validFrom: new Date(Date.now() - 10 * 86400000).toISOString(),
      validTo: new Date(Date.now() + 80 * 86400000).toISOString(),
      daysUntilExpiration: 80,
      status: 'VALID',
    },
    {
      podName: 'nextcloud-769c8f94cb-k4',
      namespace: 'nextcloud',
      serviceAccount: 'nextcloud-sa',
      spiffeId: 'spiffe://cluster.local/ns/nextcloud/sa/nextcloud-sa',
      certSerial: '99:12:0F:D4:55:62',
      issuer: 'Cilium / SPIRE Intermediate CA',
      validFrom: new Date(Date.now() - 86 * 86400000).toISOString(),
      validTo: new Date(Date.now() + 4 * 86400000).toISOString(),
      daysUntilExpiration: 4,
      status: 'EXPIRING_SOON',
    },
    {
      podName: 'postgres-postgresql-0',
      namespace: 'postgres',
      serviceAccount: 'postgres-sa',
      spiffeId: 'spiffe://cluster.local/ns/postgres/sa/postgres-sa',
      certSerial: 'AA:55:01:23:FE:84',
      issuer: 'Cilium / SPIRE Intermediate CA',
      validFrom: new Date(Date.now() - 20 * 86400000).toISOString(),
      validTo: new Date(Date.now() + 70 * 86400000).toISOString(),
      daysUntilExpiration: 70,
      status: 'VALID',
    },
    {
      podName: 'redis-master-0',
      namespace: 'redis',
      serviceAccount: 'redis-sa',
      spiffeId: 'spiffe://cluster.local/ns/redis/sa/redis-sa',
      certSerial: '11:22:33:44:55:66',
      issuer: 'Cilium / SPIRE Intermediate CA',
      validFrom: new Date(Date.now() - 15 * 86400000).toISOString(),
      validTo: new Date(Date.now() + 75 * 86400000).toISOString(),
      daysUntilExpiration: 75,
      status: 'VALID',
    },
  ];
}

export async function getMtlsTopology(): Promise<TlsConnectionLink[]> {
  const isNextcloudStrict = strictMtlsNamespaces.has('nextcloud');
  const isPostgresStrict = strictMtlsNamespaces.has('postgres');

  return [
    {
      id: 'link-traefik-keycloak',
      sourceWorkload: 'traefik',
      sourceNamespace: 'traefik',
      targetWorkload: 'keycloak',
      targetNamespace: 'keycloak',
      port: 8080,
      protocol: 'HTTPS/gRPC',
      tlsMode: 'STRICT_MTLS',
      cipherSuite: 'TLS_AES_256_GCM_SHA384',
      latencyMs: 1.2,
    },
    {
      id: 'link-keycloak-postgres',
      sourceWorkload: 'keycloak',
      sourceNamespace: 'keycloak',
      targetWorkload: 'postgres',
      targetNamespace: 'postgres',
      port: 5432,
      protocol: 'PostgreSQL Wire TLS',
      tlsMode: isPostgresStrict ? 'STRICT_MTLS' : 'PERMISSIVE_TLS',
      cipherSuite: 'TLS_CHACHA20_POLY1305_SHA256',
      latencyMs: 0.8,
    },
    {
      id: 'link-traefik-nextcloud',
      sourceWorkload: 'traefik',
      sourceNamespace: 'traefik',
      targetWorkload: 'nextcloud',
      targetNamespace: 'nextcloud',
      port: 80,
      protocol: 'HTTP',
      tlsMode: isNextcloudStrict ? 'STRICT_MTLS' : 'PLAINTEXT',
      cipherSuite: isNextcloudStrict ? 'TLS_AES_128_GCM_SHA256' : 'None (Unencrypted)',
      latencyMs: 1.5,
    },
    {
      id: 'link-nextcloud-redis',
      sourceWorkload: 'nextcloud',
      sourceNamespace: 'nextcloud',
      targetWorkload: 'redis',
      targetNamespace: 'redis',
      port: 6379,
      protocol: 'RESP3',
      tlsMode: strictMtlsNamespaces.has('redis') ? 'STRICT_MTLS' : 'PERMISSIVE_TLS',
      cipherSuite: 'TLS_AES_128_GCM_SHA256',
      latencyMs: 0.4,
    },
  ];
}

export async function enforceStrictMtls(
  namespace: string
): Promise<{ success: boolean; namespace: string; manifest: string; message: string }> {
  strictMtlsNamespaces.add(namespace);

  const manifest = `apiVersion: security.cilium.io/v1
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: strict-mtls-${namespace}
spec:
  endpointSelector:
    matchLabels:
      k8s:io.kubernetes.pod.namespace: ${namespace}
  ingress:
  - authentication:
      mode: required
  egress:
  - authentication:
      mode: required
`;

  return {
    success: true,
    namespace,
    manifest,
    message: `Enforced strict mutual TLS encryption on all ingress and egress paths in namespace [${namespace}].`,
  };
}
