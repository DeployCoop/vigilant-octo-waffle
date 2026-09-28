import { NextResponse } from 'next/server';
import { generateProductionBlueprint, BlueprintOptions } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BlueprintOptions;
    if (!body.provider || !['aws', 'gcp', 'azure', 'baremetal'].includes(body.provider)) {
      return NextResponse.json(
        { error: 'Valid provider (aws, gcp, azure, baremetal) is required' },
        { status: 400 }
      );
    }

    const blueprint = generateProductionBlueprint({
      provider: body.provider,
      clusterName: body.clusterName,
      domain: body.domain,
      enabledAppIds: body.enabledAppIds || ['argocd', 'certmanager', 'traefik', 'minio', 'kubegres'],
    });

    return NextResponse.json({
      success: true,
      blueprint,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Blueprint generation failed' },
      { status: 500 }
    );
  }
}
