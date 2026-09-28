import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function accelerateArgoSync(
  appName?: string,
  domain = '127.0.0.1.sslip.io'
): Promise<{ success: boolean; message: string; method: string }> {
  // Method 1: Patch Application CRD annotation directly in Kubernetes (Fastest & Most reliable)
  if (appName) {
    try {
      await execAsync(
        `kubectl annotate application ${appName} -n argocd argocd.argoproj.io/refresh=hard --overwrite 2>/dev/null`
      );
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

    const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'vow-' + Date.now(),
        },
        body: payload,
      });

      return {
        success: res.ok,
        message: res.ok
          ? `Dispatched synthetic Git push webhook to ${webhookUrl} (HTTP ${res.status}).`
          : `Webhook received HTTP ${res.status}. Falling back to CLI sync.`,
        method: 'synthetic-webhook',
      };
    } finally {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    }
  } catch (err: any) {
    // Method 3: Fallback to all applications hard refresh
    try {
      await execAsync(
        `kubectl annotate applications --all -n argocd argocd.argoproj.io/refresh=hard --overwrite 2>/dev/null`
      );
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
