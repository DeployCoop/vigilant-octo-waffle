export interface PreviewEnvironment {
  id: string;
  prNumber: number;
  branch: string;
  appName: string;
  namespace: string;
  subdomain: string;
  previewUrl: string;
  status: 'provisioning' | 'ready' | 'expired' | 'terminating';
  createdAt: string;
  expiresAt: string;
  ttlMinutes: number;
  remainingMinutes: number;
  commitSha: string;
  imageTag: string;
  replicas: number;
  resourceLimits: {
    cpu: string;
    memory: string;
  };
}

export interface CreatePreviewParams {
  prNumber: number;
  branch: string;
  appName: string;
  ttlMinutes?: number;
  commitSha?: string;
  imageTag?: string;
}

// In-memory registry of preview environments with initial active previews
let previewsStore: PreviewEnvironment[] = [
  {
    id: 'prev-pr-42-store',
    prNumber: 42,
    branch: 'feat/checkout-redesign',
    appName: 'nextcloud',
    namespace: 'preview-pr-42-nextcloud',
    subdomain: 'pr-42-nextcloud.127.0.0.1.sslip.io',
    previewUrl: 'https://pr-42-nextcloud.127.0.0.1.sslip.io',
    status: 'ready',
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 75 * 60 * 1000).toISOString(),
    ttlMinutes: 120,
    remainingMinutes: 75,
    commitSha: 'a7c39f1',
    imageTag: 'pr-42-sha-a7c39f1',
    replicas: 1,
    resourceLimits: {
      cpu: '500m',
      memory: '512Mi',
    },
  },
  {
    id: 'prev-pr-89-auth',
    prNumber: 89,
    branch: 'fix/oidc-session-timeout',
    appName: 'keycloak',
    namespace: 'preview-pr-89-keycloak',
    subdomain: 'pr-89-keycloak.127.0.0.1.sslip.io',
    previewUrl: 'https://pr-89-keycloak.127.0.0.1.sslip.io',
    status: 'ready',
    createdAt: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ttlMinutes: 120,
    remainingMinutes: 10,
    commitSha: '9b2d8e4',
    imageTag: 'pr-89-sha-9b2d8e4',
    replicas: 1,
    resourceLimits: {
      cpu: '1000m',
      memory: '1024Mi',
    },
  },
];

export async function listPreviewEnvironments(): Promise<PreviewEnvironment[]> {
  const now = Date.now();
  previewsStore = previewsStore.map((p) => {
    const expires = new Date(p.expiresAt).getTime();
    const remaining = Math.max(0, Math.round((expires - now) / 60000));
    const status = remaining === 0 ? 'expired' : p.status;
    return {
      ...p,
      remainingMinutes: remaining,
      status,
    };
  });
  return [...previewsStore];
}

export async function createPreviewEnvironment(params: CreatePreviewParams): Promise<PreviewEnvironment> {
  const ttl = params.ttlMinutes || 120;
  const now = new Date();
  const expires = new Date(now.getTime() + ttl * 60 * 1000);
  const cleanApp = params.appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const id = `prev-pr-${params.prNumber}-${cleanApp}`;
  const namespace = `preview-pr-${params.prNumber}-${cleanApp}`;
  const subdomain = `pr-${params.prNumber}-${cleanApp}.127.0.0.1.sslip.io`;

  // Remove existing with same id if replacing
  previewsStore = previewsStore.filter((p) => p.id !== id);

  const newPreview: PreviewEnvironment = {
    id,
    prNumber: params.prNumber,
    branch: params.branch,
    appName: params.appName,
    namespace,
    subdomain,
    previewUrl: `https://${subdomain}`,
    status: 'ready',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ttlMinutes: ttl,
    remainingMinutes: ttl,
    commitSha: params.commitSha || 'c0ffee7',
    imageTag: params.imageTag || `pr-${params.prNumber}-latest`,
    replicas: 1,
    resourceLimits: {
      cpu: '500m',
      memory: '512Mi',
    },
  };

  previewsStore.unshift(newPreview);
  return newPreview;
}

export async function destroyPreviewEnvironment(id: string): Promise<{ success: boolean; message: string }> {
  const exists = previewsStore.find((p) => p.id === id);
  if (!exists) {
    return { success: false, message: `Preview environment ${id} not found` };
  }
  previewsStore = previewsStore.filter((p) => p.id !== id);
  return { success: true, message: `Purged preview namespace ${exists.namespace} and associated ingress routes.` };
}

export async function extendPreviewTtl(id: string, additionalMinutes: number = 60): Promise<PreviewEnvironment | null> {
  const preview = previewsStore.find((p) => p.id === id);
  if (!preview) return null;

  const currentExpires = new Date(preview.expiresAt).getTime();
  const newExpires = new Date(Math.max(Date.now(), currentExpires) + additionalMinutes * 60 * 1000);

  preview.expiresAt = newExpires.toISOString();
  preview.ttlMinutes += additionalMinutes;
  preview.remainingMinutes = Math.max(0, Math.round((newExpires.getTime() - Date.now()) / 60000));
  if (preview.status === 'expired') {
    preview.status = 'ready';
  }

  return { ...preview };
}

export async function cleanupExpiredPreviews(): Promise<{ purgedCount: number; purgedIds: string[] }> {
  await listPreviewEnvironments();
  const expired = previewsStore.filter((p) => p.status === 'expired' || p.remainingMinutes <= 0);
  const purgedIds = expired.map((p) => p.id);
  previewsStore = previewsStore.filter((p) => p.status !== 'expired' && p.remainingMinutes > 0);
  return { purgedCount: purgedIds.length, purgedIds };
}
