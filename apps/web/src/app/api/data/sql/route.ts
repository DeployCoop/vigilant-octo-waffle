import { NextResponse } from 'next/server';
import { executePostgresQuery } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query, database, namespace } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'query string is required' },
        { status: 400 }
      );
    }

    const result = await executePostgresQuery(query, { database, namespace });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Database query execution failed', success: false },
      { status: 400 }
    );
  }
}
