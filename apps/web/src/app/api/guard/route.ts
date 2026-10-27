import { NextResponse } from 'next/server';
import {
  listAdmissionPolicies,
  evaluateManifest,
  togglePolicyRule,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'security:read');
  if (denied) return denied;

  try {
    const policies = await listAdmissionPolicies();
    return NextResponse.json({ policies });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/guard',
      fallbackMessage: 'Failed to list admission policies',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'security:read');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action, yaml, ruleId, enabled } = body;

    if (action === 'toggle') {
      if (!ruleId) {
        return apiError(400, 'ruleId is required');
      }
      const updated = await togglePolicyRule(ruleId, Boolean(enabled));
      return NextResponse.json({ success: true, rule: updated });
    }

    if (!yaml) {
      return apiError(400, 'yaml content is required');
    }

    const evaluation = await evaluateManifest(yaml);
    return NextResponse.json({ success: true, evaluation });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/guard',
      fallbackMessage: 'Failed to evaluate manifest',
    });
  }
}
