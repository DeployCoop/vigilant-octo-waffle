import { NextResponse } from 'next/server';
import {
  listPreviewEnvironments,
  createPreviewEnvironment,
  destroyPreviewEnvironment,
  extendPreviewTtl,
  cleanupExpiredPreviews,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'apps:read');
  if (denied) return denied;

  try {
    const previews = await listPreviewEnvironments();
    return NextResponse.json({ previews });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/previews',
      fallbackMessage: 'Failed to list preview environments',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'apps:deploy');
  if (denied) return denied;

  try {
    const body = await req.json();
    if (body.action === 'cleanup') {
      const result = await cleanupExpiredPreviews();
      return NextResponse.json(result);
    }

    const { prNumber, branch, appName, ttlMinutes = 120 } = body;
    if (!prNumber || !branch || !appName) {
      return apiError(400, 'prNumber, branch, and appName are required');
    }

    const preview = await createPreviewEnvironment({
      prNumber: Number(prNumber),
      branch,
      appName,
      ttlMinutes: Number(ttlMinutes),
    });

    return NextResponse.json({ success: true, preview });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/previews',
      fallbackMessage: 'Failed to create preview environment',
    });
  }
}

export async function DELETE(req: Request) {
  const denied = await authorizeRequest(req, 'apps:deploy');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return apiError(400, 'id query param is required');
    }

    const result = await destroyPreviewEnvironment(id);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'DELETE /api/previews',
      fallbackMessage: 'Failed to delete preview environment',
    });
  }
}

export async function PATCH(req: Request) {
  const denied = await authorizeRequest(req, 'apps:deploy');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { id, additionalMinutes = 60 } = body;
    if (!id) {
      return apiError(400, 'id is required');
    }

    const updated = await extendPreviewTtl(id, Number(additionalMinutes));
    if (!updated) {
      return apiError(404, 'Preview environment not found');
    }

    return NextResponse.json({ success: true, preview: updated });
  } catch (err) {
    return routeError(err, {
      route: 'PATCH /api/previews',
      fallbackMessage: 'Failed to extend preview TTL',
    });
  }
}
