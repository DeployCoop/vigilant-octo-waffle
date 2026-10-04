import { NextResponse } from 'next/server';
import { generateProductionBlueprint, BlueprintOptions } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'export:run');
  if (denied) return denied;

  try {
    const body = (await req.json()) as BlueprintOptions;
    if (!body.provider || !['aws', 'gcp', 'azure', 'baremetal'].includes(body.provider)) {
      return apiError(400, 'Valid provider (aws, gcp, azure, baremetal) is required');
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
  } catch (err) {
    return routeError(err, { route: 'POST /api/export', fallbackMessage: 'Blueprint generation failed' });
  }
}
