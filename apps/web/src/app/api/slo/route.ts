import { NextResponse } from 'next/server';
import {
  getServiceSlos,
  calculateBurnRates,
  toggleSloCircuitBreaker,
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
    const { serviceId, action, tripped } = body;

    if (!serviceId) {
      return apiError(400, 'serviceId is required');
    }

    if (action === 'toggle_circuit_breaker') {
      const result = await toggleSloCircuitBreaker(serviceId, Boolean(tripped));
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
