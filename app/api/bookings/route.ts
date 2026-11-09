import { NextRequest, NextResponse } from 'next/server';
import {
  sql,
  ensureSchema,
  API_KEY,
  bodyHash,
  newBookingId,
  getSlot,
  findConfirmedBySlot,
  getBooking,
  listBookings,
  rateBucket,
} from '../../../lib/db';

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const email = req.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  let limit = 10;
  const limitParam = req.nextUrl.searchParams.get('limit');
  if (limitParam !== null) {
    limit = parseInt(limitParam, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return NextResponse.json({ error: 'invalid limit' }, { status: 400 });
    }
  }

  const cursorParam = req.nextUrl.searchParams.get('cursor');
  const cursor = cursorParam && cursorParam.length > 0 ? cursorParam : null;
  const emailNorm = String(email).trim().toLowerCase();
  const { bookings, next_cursor } = await listBookings(emailNorm, limit, cursor);

  return NextResponse.json({ bookings, next_cursor });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await ensureSchema();
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const key = req.headers.get('Idempotency-Key');
  const hash = bodyHash(body);
  const emailForRate = String(body.email !== undefined ? body.email : '').trim().toLowerCase();

  if (key) {
    const idemRows = await sql`SELECT idem_key, body_hash, status, booking_id FROM idempotency_keys WHERE idem_key = ${key}`;
    const idem = idemRows[0] as any;
    if (idem) {
      if (idem.body_hash === hash) {
        if (Number(idem.status) === 201) {
          const previous = await getBooking(String(idem.booking_id));
          if (previous) {
            return NextResponse.json(previous, { status: 201 });
          }
          return NextResponse.json({ error: 'booking not found' }, { status: 404 });
        }
        return NextResponse.json({ error: 'idempotent replay' }, { status: Number(idem.status) });
      }
      return NextResponse.json({ error: 'idempotency key reused with different body' }, { status: 422 });
    }
  }

  const rate = await rateBucket(emailForRate);
  if (rate.blocked) {
    return NextResponse.json(
      { error: 'too many attempts' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  const slotId = body.slot_id !== undefined && body.slot_id !== null ? String(body.slot_id).trim() : '';
  const name = body.name !== undefined && body.name !== null ? String(body.name).trim() : '';
  const email = body.email !== undefined && body.email !== null ? String(body.email).trim().toLowerCase() : '';

  if (!slotId || !name || !email) {
    return NextResponse.json({ error: 'missing field' }, { status: 400 });
  }

  const emailParts = email.split('@');
  const emailOk =
    emailParts.length === 2 &&
    emailParts[0].length > 0 &&
    emailParts[1].length > 0 &&
    emailParts[1].includes('.');
  if (!emailOk) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }

  const slot = await getSlot(slotId);
  if (!slot) {
    return NextResponse.json({ error: 'slot not found' }, { status: 404 });
  }
  if (Date.parse(slot.start) <= Date.now()) {
    return NextResponse.json({ error: 'slot already started' }, { status: 400 });
  }
  const existing = await findConfirmedBySlot(slotId);
  if (existing) {
    return NextResponse.json({ error: 'slot already booked' }, { status: 409 });
  }

  const id = newBookingId();
  try {
    await sql`INSERT INTO bookings (id, slot_id, name, email, status, created_at)
      VALUES (${id}, ${slotId}, ${name}, ${email}, 'confirmed', ${new Date().toISOString()})`;
  } catch (error: any) {
    if (error?.code === '23505' || String(error?.message || '').includes('duplicate key')) {
      return NextResponse.json({ error: 'slot already booked' }, { status: 409 });
    }
    throw error;
  }

  if (key) {
    await sql`INSERT INTO idempotency_keys (idem_key, body_hash, status, booking_id)
      VALUES (${key}, ${hash}, 201, ${id})`;
  }

  const booking = await getBooking(id);
  return NextResponse.json(booking, { status: 201 });
}
