export interface EndpointHealth {
  appId: string;
  appName: string;
  url: string;
  status: 'healthy' | 'starting' | 'unreachable';
  statusCode?: number;
  latencyMs: number;
  message?: string;
}

export async function probeEndpoint(
  appId: string,
  appName: string,
  url: string,
  timeoutMs = 4000
): Promise<EndpointHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Disable SSL verification for local probing (mkcert / self-signed local certs)
    const prevTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Vow-HealthProber/1.0',
        },
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      const code = response.status;
      // 2xx or 3xx or 401/403 (service is up and responding with auth prompt) are considered healthy
      if (code < 500) {
        return {
          appId,
          appName,
          url,
          status: 'healthy',
          statusCode: code,
          latencyMs,
        };
      }

      // 502/503/504 typically means ingress controller is up but pod container is still initializing
      return {
        appId,
        appName,
        url,
        status: 'starting',
        statusCode: code,
        latencyMs,
        message: `HTTP ${code} (Container starting up)`,
      };
    } finally {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTlsReject;
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const isTimeout = err.name === 'AbortError';

    return {
      appId,
      appName,
      url,
      status: 'unreachable',
      latencyMs,
      message: isTimeout ? 'Connection timed out' : (err.message || 'Connection refused'),
    };
  }
}

export async function probeAllEndpoints(
  apps: { id: string; name: string; ingressUrl?: string; enabled: boolean }[]
): Promise<EndpointHealth[]> {
  const targetApps = apps.filter((a) => a.enabled && a.ingressUrl);
  const results: EndpointHealth[] = [];

  // Concurrency limit of 5
  const concurrency = 5;
  for (let i = 0; i < targetApps.length; i += concurrency) {
    const batch = targetApps.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((app) => probeEndpoint(app.id, app.name, app.ingressUrl!))
    );
    results.push(...batchResults);
  }

  return results;
}
