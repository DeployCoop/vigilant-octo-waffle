import { NextResponse } from 'next/server';
import {
  inspectWasmRuntimes,
  getWasmBenchmarks,
  getWasmCatalog,
  deployWasmMicroservice,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'apps:read');
  if (denied) return denied;

  try {
    const [runtime, benchmarks, catalog] = await Promise.all([
      inspectWasmRuntimes(),
      getWasmBenchmarks(),
      getWasmCatalog(),
    ]);

    return NextResponse.json({
      runtime,
      benchmarks,
      catalog,
    });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/wasm',
      fallbackMessage: 'Failed to fetch Wasm runtime info',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'apps:deploy');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { serviceId, namespace = 'default' } = body;

    if (!serviceId) {
      return apiError(400, 'serviceId is required');
    }

    const result = await deployWasmMicroservice(serviceId, namespace);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/wasm',
      fallbackMessage: 'Failed to deploy Wasm microservice',
    });
  }
}
