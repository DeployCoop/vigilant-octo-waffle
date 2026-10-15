import * as https from 'node:https';
import { execFileAsync, assertK8sObjectName } from './exec-argv.js';

/**
 * POSTs JSON to an https URL with certificate verification disabled for
 * THIS request only. (The previous implementation flipped the process-wide
 * NODE_TLS_REJECT_UNAUTHORIZED env var for the duration of a fetch, which
 * silently disabled TLS verification for every other in-flight request in
 * the server.) The ArgoCD ingress here is a local-cluster endpoint with a
 * self-signed/mkcert certificate, which is why verification is off — keep
 * it scoped to this one call.
 */
function httpsPostJsonInsecure(url: string, payload: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'vow-' + Date.now(),
        },
        rejectUnauthorized: false,
        timeout: 10000,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('timeout', () => req.destroy(new Error('webhook request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

function isValidDomain(domain: string): boolean {
  return (
    domain.length <= 253 &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(domain)
  );
}

export async function accelerateArgoSync(
  appName?: string,
  domain = '127.0.0.1.sslip.io'
): Promise<{ success: boolean; message: string; method: string }> {
  // appName/domain arrive from the webhook request body. They used to be
  // interpolated into a shell string (arbitrary command execution for the
  // least-privilege webhook caller). Validate, then execute argv-only.
  if (appName) {
    try {
      assertK8sObjectName(appName, 'application name');
    } catch (err: any) {
      return { success: false, message: err.message, method: 'invalid' };
    }
  }
  if (!isValidDomain(domain)) {
    return { success: false, message: `Invalid domain: ${JSON.stringify(domain)}`, method: 'invalid' };
  }

  // Method 1: Patch Application CRD annotation directly in Kubernetes (Fastest & Most reliable)
  if (appName) {
    try {
      await execFileAsync('kubectl', [
        'annotate',
        'application',
        appName,
        '-n',
        'argocd',
        'argocd.argoproj.io/refresh=hard',
        '--overwrite',
      ]);
      return {
        success: true,
        message: `Dispatched hard-refresh annotation to ArgoCD for application '${appName}'. Reconciliation started immediately.`,
        method: 'k8s-crd-annotation',
      };
    } catch {
      // Fallback
    }
  }

  // Method 2: Synthetic GitHub Push Webhook to ArgoCD Ingress
  try {
    const webhookUrl = `https://argocd.${domain}/api/webhook`;
    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      commits: [
        {
          id: 'manual-trigger-' + Date.now(),
          message: 'Fast sync triggered from Vigilant Octo Waffle Web Control Plane',
        },
      ],
    });

    const status = await httpsPostJsonInsecure(webhookUrl, payload);
    const ok = status >= 200 && status < 300;
    return {
      success: ok,
      message: ok
        ? `Dispatched synthetic Git push webhook to ${webhookUrl} (HTTP ${status}).`
        : `Webhook received HTTP ${status}. Falling back to CLI sync.`,
      method: 'synthetic-webhook',
    };
  } catch (err: any) {
    // Method 3: Fallback to all applications hard refresh
    try {
      await execFileAsync('kubectl', [
        'annotate',
        'applications',
        '--all',
        '-n',
        'argocd',
        'argocd.argoproj.io/refresh=hard',
        '--overwrite',
      ]);
      return {
        success: true,
        message: 'Dispatched hard-refresh annotation to all active ArgoCD applications in cluster.',
        method: 'k8s-crd-all-annotation',
      };
    } catch (e: any) {
      return {
        success: false,
        message: `Sync accelerator error: ${err.message || e.message}`,
        method: 'failed',
      };
    }
  }
}
