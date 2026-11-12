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
  try {
    const body = await req.json();
    const { action, yaml, ruleId, enabled } = body;

    // BUG FIX (bug hunt B3): toggling mutates shared admission policy,
    // so it requires the manage permission — the old single
    // security:read gate let any viewer disable policies. The pure
    // manifest-evaluation path below stays read-gated (chaos route
    // precedent: chaos:run POST / security:read GET).
    if (action === 'toggle') {
      const denied = await authorizeRequest(req, 'security:manage');
      if (denied) return denied;
      if (!ruleId) {
        return apiError(400, 'ruleId is required');
      }
      const updated = await togglePolicyRule(ruleId, Boolean(enabled));
      return NextResponse.json({ success: true, rule: updated });
    }

    const denied = await authorizeRequest(req, 'security:read');
    if (denied) return denied;

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
