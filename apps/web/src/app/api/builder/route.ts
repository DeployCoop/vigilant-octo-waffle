import { NextResponse } from 'next/server';
import { listLocalImages, buildLocalContainerImage } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'builder:run');
  if (denied) return denied;

  try {
    const images = await listLocalImages();
    return NextResponse.json({ images });
  } catch (err) {
    return routeError(err, { route: 'GET /api/builder', fallbackMessage: 'Failed to list local container images' });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'builder:run');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action = 'build', imageName, tag = 'latest', dockerfileContent, pushToLocalRegistry = true } = body;

    if (action === 'build') {
      if (!imageName || !dockerfileContent) {
        return apiError(400, 'imageName and dockerfileContent are required');
      }

      const result = await buildLocalContainerImage({
        imageName,
        tag,
        dockerfileContent,
        pushToLocalRegistry,
      });

      return NextResponse.json(result);
    }

    return apiError(400, `Unknown builder action: ${action}`);
  } catch (err) {
    return routeError(err, { route: 'POST /api/builder', fallbackMessage: 'Image build execution failed' });
  }
}
