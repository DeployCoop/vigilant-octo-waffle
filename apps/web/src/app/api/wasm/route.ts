import { NextResponse } from 'next/server';
import {
  inspectWasmRuntimes,
  getWasmBenchmarks,
  getWasmCatalog,
  deployWasmMicroservice,
  wasmDeploySchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

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
    // C7: serviceId/namespace must be DNS-1123 labels (C6 builds the
    // manifests as objects, so a hostile name cannot inject YAML fields).
    // C4: an unknown serviceId stays 200-with-success:false (per the C8
    // scope) and is surfaced by the page's POST else branch.
    const { serviceId, namespace } = wasmDeploySchema.parse(body);

    const result = await deployWasmMicroservice(serviceId, namespace);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/wasm',
      fallbackMessage: 'Failed to deploy Wasm microservice',
    });
  }
}
