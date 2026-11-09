import { NextRequest, NextResponse } from 'next/server';
import { sql, ensureSchema, API_KEY } from '../../lib/db';

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await ensureSchema();
  const provider = req.nextUrl.searchParams.get('provider');

  const rows = provider
    ? await sql`SELECT s.id, s.provider, s.slot_start, s.slot_end,
        NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
        FROM slots s WHERE s.provider = ${provider} ORDER BY s.slot_start ASC`
    : await sql`SELECT s.id, s.provider, s.slot_start, s.slot_end,
        NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
        FROM slots s ORDER BY s.slot_start ASC`;

  const slots = rows.map((s: any) => ({
    id: s.id,
    provider: s.provider,
    start: s.slot_start,
    end: s.slot_end,
    available: Boolean(s.available),
  }));

  return NextResponse.json({ slots });
}
