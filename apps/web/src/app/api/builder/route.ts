import { NextResponse } from 'next/server';
import { listLocalImages, buildLocalContainerImage } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const images = await listLocalImages();
    return NextResponse.json({ images });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to list local container images', images: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action = 'build', imageName, tag = 'latest', dockerfileContent, pushToLocalRegistry = true } = body;

    if (action === 'build') {
      if (!imageName || !dockerfileContent) {
        return NextResponse.json(
          { error: 'imageName and dockerfileContent are required' },
          { status: 400 }
        );
      }

      const result = await buildLocalContainerImage({
        imageName,
        tag,
        dockerfileContent,
        pushToLocalRegistry,
      });

      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: `Unknown builder action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Image build execution failed' },
      { status: 500 }
    );
  }
}
