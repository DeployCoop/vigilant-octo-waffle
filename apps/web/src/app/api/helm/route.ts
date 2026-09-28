import { NextResponse } from 'next/server';
import { listHelmReleases, getHelmReleaseValues } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const release = searchParams.get('release');
    const namespace = searchParams.get('namespace');

    if (release && namespace) {
      const values = await getHelmReleaseValues(release, namespace);
      return NextResponse.json({ release, namespace, values });
    }

    const releases = await listHelmReleases();
    return NextResponse.json({ releases });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, releases: [] }, { status: 500 });
  }
}
