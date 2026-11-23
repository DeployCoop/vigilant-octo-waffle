import { NextResponse } from 'next/server';
import {
  listPreviewEnvironments,
  createPreviewEnvironment,
  destroyPreviewEnvironment,
  extendPreviewTtl,
  cleanupExpiredPreviews,
  previewsCreateSchema,
  previewsExtendSchema,
  PreviewConflictError,
  PreviewAppNotFoundError,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';
import { getProjectRoot } from '@/lib/project';

/**
 * Wired-studio error mapping (Batch C): the previews module throws
 * typed errors for its expected failures, and they map to the envelope
 * statuses here — 409 conflict, 404 not_found — instead of falling
 * through to routeError's 500. ClusterUnavailableError needs no branch
 * here: routeError maps it to 503 cluster_unavailable.
 */
function previewErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof PreviewConflictError) {
    return apiError(409, err.message, { code: 'conflict' });
  }
  if (err instanceof PreviewAppNotFoundError) {
    return apiError(404, err.message, { code: 'not_found' });
  }
  return null;
}

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
      const result = await cleanupExpiredPreviews({ projectRoot: getProjectRoot() });
      return NextResponse.json(result);
    }

    // C7: prNumber/ttlMinutes must be real finite ints (Number('abc') used
    // to smuggle NaN into the id as `prev-pr-NaN-app`).
    const params = previewsCreateSchema.parse(body);

    const preview = await createPreviewEnvironment(params, {
      projectRoot: getProjectRoot(),
    });

    return NextResponse.json({ success: true, preview });
  } catch (err) {
    return (
      previewErrorResponse(err) ??
      routeError(err, {
        route: 'POST /api/previews',
        fallbackMessage: 'Failed to create preview environment',
      })
    );
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

    const result = await destroyPreviewEnvironment(id, { projectRoot: getProjectRoot() });
    // C8: destroying an unknown preview 404s instead of returning success:false.
    if (!result.success) return apiError(404, result.message);
    return NextResponse.json(result);
  } catch (err) {
    return (
      previewErrorResponse(err) ??
      routeError(err, {
        route: 'DELETE /api/previews',
        fallbackMessage: 'Failed to delete preview environment',
      })
    );
  }
}

export async function PATCH(req: Request) {
  const denied = await authorizeRequest(req, 'apps:deploy');
  if (denied) return denied;

  try {
    const body = await req.json();
    // C7: additionalMinutes must be a real int (no Number() coercion).
    const { id, additionalMinutes } = previewsExtendSchema.parse(body);

    const updated = await extendPreviewTtl(id, additionalMinutes);
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
