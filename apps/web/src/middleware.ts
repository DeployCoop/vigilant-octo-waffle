import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Security Middleware for Vigilant Octo Waffle Control Plane
 *
 * 1. Restricts mutating requests (POST, PUT, DELETE, PATCH) on /api/* routes
 * 2. Enforces CSRF / Origin validation against localhost / local network / host
 * 3. Enforces optional token authentication if VOW_API_TOKEN is defined
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect mutating API endpoints
  if (pathname.startsWith('/api/') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    // 1. Optional API Token Gate
    const requiredToken = process.env.VOW_API_TOKEN;
    if (requiredToken) {
      const authHeader = request.headers.get('authorization');
      const customTokenHeader = request.headers.get('x-vow-token');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

      if (bearerToken !== requiredToken && customTokenHeader !== requiredToken) {
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
