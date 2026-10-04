import { NextResponse } from 'next/server';
import { scanClusterSecurity } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'security:read');
  if (denied) return denied;

  try {
    const report = await scanClusterSecurity();
    const formattedFindings = report.findings.map((f) => ({
      ...f,
      resource: f.resourceName,
    }));
    return NextResponse.json({
      ...report,
      findings: formattedFindings,
      summary: report.totals,
      totalWorkloads: report.totals.scannedPods + (report.totals.scannedIngresses || 0),
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Security audit execution failed' },
      { status: 500 }
    );
  }
}
