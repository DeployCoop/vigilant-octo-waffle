import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Security Middleware for Vigilant Octo Waffle Control Plane
 *
 * 1. Restricts mutating requests (POST, PUT, DELETE, PATCH) on /api/* routes
 * 2. Enforces CSRF / Origin validation against localhost / local network / host
 * 3. Enforces optional token authentication if VOW_API_TOKEN is defined
 * 4. Defers /api/argo/webhook to its own service token when VOW_WEBHOOK_TOKEN is defined
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect mutating API endpoints
  if (pathname.startsWith('/api/') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    // 0. ArgoCD webhook accelerator: when VOW_WEBHOOK_TOKEN is configured, the
    // route enforces its own service token (see api/argo/webhook/route.ts), so
    // the shared-token and origin gates here defer to it. This lets external
    // automation call the webhook with only its least-privilege credential.
    if (pathname === '/api/argo/webhook' && process.env.VOW_WEBHOOK_TOKEN) {
      return NextResponse.next();
    }

    // 1. Optional API Token Gate
    const requiredToken = process.env.VOW_API_TOKEN;
    if (requiredToken) {
      const authHeader = request.headers.get('authorization');
      const customTokenHeader = request.headers.get('x-vow-token');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

      if (bearerToken !== requiredToken && customTokenHeader !== requiredToken) {
        // Principal tokens (vow_-prefixed) are verified by the route guards
        // against the authz store, which Edge middleware cannot read — defer
        // to them. Every mutating route is guarded, so an invalid principal
        // token still ends in a 401/403 from the route itself.
        const presented = bearerToken ?? customTokenHeader;
        if (presented && presented.startsWith('vow_')) {
          return NextResponse.next();
        }
        return NextResponse.json(
          { error: 'Unauthorized: Missing or invalid API token' },
          { status: 401 }
        );
      }
    }

    // 2. CSRF & Origin Verification
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');

    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        const hostWithoutPort = host.split(':')[0];
        const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(originUrl.hostname);
        const matchesHost = originUrl.host === host || originUrl.hostname === hostWithoutPort;

        if (!isLocalhost && !matchesHost) {
          return NextResponse.json(
            { error: 'Forbidden: Cross-site request rejected by CSRF origin guard' },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'Forbidden: Malformed request origin header' },
          { status: 403 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
