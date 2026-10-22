import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface EndpointHealth {
  appId: string;
  appName: string;
  url: string;
  status: 'healthy' | 'starting' | 'unreachable';
  statusCode?: number;
  latencyMs: number;
  message?: string;
}


/**
 * One HEAD request, following redirects like fetch did. TLS verification is
 * disabled for THIS request only (local mkcert / self-signed ingress certs)
 * via a per-request option — the previous implementation flipped the
 * process-wide NODE_TLS_REJECT_UNAUTHORIZED env var for the probe's
 * duration, which raced between concurrent probes (a sibling could capture
 * and restore '0', leaving verification off process-wide) and left every
 * other in-flight TLS connection in the server unverified meanwhile.
 * Rejects with an AbortError-named error on timeout.
 */
function headStatus(url: string, timeoutMs: number, redirectsLeft: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const req = (isHttps ? httpsRequest : httpRequest)(
      parsed,
      {
        method: 'HEAD',
        headers: { 'User-Agent': 'Vow-HealthProber/1.0' },
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const code = res.statusCode ?? 0;
        const location = res.headers.location;
        res.resume();
        if (redirectsLeft > 0 && code >= 300 && code < 400 && location) {
          resolve(headStatus(new URL(location, parsed).toString(), timeoutMs, redirectsLeft - 1));
        } else {
          resolve(code);
        }
      }
    );
    req.setTimeout(timeoutMs, () => {
      const err = new Error('Connection timed out');
      err.name = 'AbortError';
      req.destroy(err);
    });
    req.on('error', reject);
    req.end();
  });
}

export async function probeEndpoint(
  appId: string,
  appName: string,
  url: string,
  timeoutMs = 4000
): Promise<EndpointHealth> {
  const start = Date.now();
  try {
    const code = await headStatus(url, timeoutMs, 5);
    const latencyMs = Date.now() - start;

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
