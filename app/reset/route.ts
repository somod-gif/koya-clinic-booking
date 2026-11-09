import { NextRequest, NextResponse } from 'next/server';
import { sql, API_KEY, resetAll } from '../../lib/db';

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const slots = body && Array.isArray(body.slots) ? body.slots : null;
  if (!slots) {
    return NextResponse.json({ error: 'slots array required' }, { status: 400 });
  }

  await resetAll();

  for (const s of slots) {
    await sql`INSERT INTO slots (id, provider, slot_start, slot_end)
      VALUES (${String(s.id)}, ${String(s.provider ?? '')}, ${String(s.start ?? '')}, ${String(s.end ?? '')})`;
  }

  return NextResponse.json({ ok: true });
}
