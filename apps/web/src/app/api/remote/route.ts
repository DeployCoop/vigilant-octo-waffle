import { NextResponse } from 'next/server';
import { createPairingSession, validatePairingToken } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Creating a pairing session mints remote-access credentials, so it is
  // guarded by the critical remote:exec permission. (Validating a pairing
  // token via POST below is the redemption endpoint and stays open.)
  const denied = await authorizeRequest(req, 'remote:exec');
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const port = parseInt(url.port) || 3000;
    const session = createPairingSession(port);
    return NextResponse.json(session);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to create remote pairing session' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token } = body;

    const isValid = validatePairingToken(token);
    return NextResponse.json({ valid: isValid });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Pairing token validation failed', valid: false },
      { status: 500 }
    );
  }
}
