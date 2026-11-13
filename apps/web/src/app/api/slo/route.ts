import { NextResponse } from 'next/server';
import {
  getServiceSlos,
  calculateBurnRates,
  toggleSloCircuitBreaker,
  sloToggleSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const serviceId = searchParams.get('serviceId');

    if (serviceId) {
      const burnRate = await calculateBurnRates(serviceId);
      // C8: an unknown service 404s instead of returning another service's rates.
      if (!burnRate) return apiError(404, `SLO for service ${serviceId} not found`);
      return NextResponse.json(burnRate);
    }

    const slos = await getServiceSlos();
    return NextResponse.json({ slos });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/slo',
      fallbackMessage: 'Failed to fetch SLO telemetry',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:manage');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'toggle_circuit_breaker') {
      // C7: serviceId non-empty, tripped a real boolean (no Boolean() coercion).
      const { serviceId, tripped } = sloToggleSchema.parse(body);
      const result = await toggleSloCircuitBreaker(serviceId, tripped);
      // C8: an unknown service 404s instead of returning success:false.
      if (!result.success) return apiError(404, result.message);
      return NextResponse.json(result);
    }

    return apiError(400, `Unknown action: ${action}`);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/slo',
      fallbackMessage: 'Failed to update SLO status',
    });
  }
}
