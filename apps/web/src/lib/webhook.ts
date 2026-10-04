/**
 * Client helper for the ArgoCD webhook accelerator route
 * (POST /api/argo/webhook).
 *
 * When the control plane is configured with VOW_WEBHOOK_TOKEN, the route
 * requires that service token. Dashboard callers keep a copy in
 * localStorage (key `vow_webhook_token`); if a call comes back 401 we
 * prompt once, store the entered token, and retry — so enabling the
 * server-side token never silently breaks the Instant Sync actions.
 */

export const WEBHOOK_TOKEN_STORAGE_KEY = 'vow_webhook_token';

function webhookHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem(WEBHOOK_TOKEN_STORAGE_KEY);
    if (token) headers['x-vow-webhook-token'] = token;
  } catch {
    // localStorage unavailable (SSR/privacy mode) — send without the token.
  }
  return headers;
}

export async function postArgoWebhook(body: unknown): Promise<Response> {
  const send = () =>
    fetch('/api/argo/webhook', {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify(body),
    });

  let res = await send();

  if (res.status === 401 && typeof window !== 'undefined') {
    const entered = window.prompt(
      'This control plane requires a webhook token (VOW_WEBHOOK_TOKEN) for Instant Sync. Enter it once and it will be remembered on this browser:'
    );
    if (entered) {
      try {
        localStorage.setItem(WEBHOOK_TOKEN_STORAGE_KEY, entered);
      } catch {
        // Ignore storage failures; the retry below still carries the token.
      }
      res = await fetch('/api/argo/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vow-webhook-token': entered },
        body: JSON.stringify(body),
      });
    }
  }

  return res;
}
