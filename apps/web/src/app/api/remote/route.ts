import { NextResponse } from 'next/server';
import { createPairingSession, validatePairingToken } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
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
