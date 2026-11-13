import { NextResponse } from 'next/server';
import {
  listAdmissionPolicies,
  evaluateManifest,
  togglePolicyRule,
  InvalidManifestError,
  guardToggleSchema,
  guardEvaluateSchema,
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
    const { action } = body;

    // BUG FIX (bug hunt B3): toggling mutates shared admission policy,
    // so it requires the manage permission — the old single
    // security:read gate let any viewer disable policies. The pure
    // manifest-evaluation path below stays read-gated (chaos route
    // precedent: chaos:run POST / security:read GET).
    if (action === 'toggle') {
      const denied = await authorizeRequest(req, 'security:manage');
      if (denied) return denied;
      // C7: enabled must be a real boolean when present (no Boolean() coercion).
      const { ruleId, enabled } = guardToggleSchema.parse(body);
      const updated = await togglePolicyRule(ruleId, enabled);
      return NextResponse.json({ success: true, rule: updated });
    }

    const denied = await authorizeRequest(req, 'security:read');
    if (denied) return denied;

    // C7: yaml must be a non-empty string.
    const { yaml } = guardEvaluateSchema.parse(body);

    const evaluation = await evaluateManifest(yaml);
    return NextResponse.json({ success: true, evaluation });
  } catch (err) {
    // C3: unparseable YAML is a client error, not a 500.
    if (err instanceof InvalidManifestError) {
      return apiError(400, 'Invalid YAML: could not parse manifest');
    }
    return routeError(err, {
      route: 'POST /api/guard',
      fallbackMessage: 'Failed to evaluate manifest',
    });
  }
}
