import { NextRequest, NextResponse } from 'next/server';
import { sql, API_KEY, getBooking } from '../../../lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }

  return NextResponse.json(booking);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) {
    return NextResponse.json({ error: 'booking not found' }, { status: 404 });
  }
  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'already cancelled' }, { status: 409 });
  }

  await sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${booking.id}`;
  const updated = await getBooking(String(booking.id));
  return NextResponse.json(updated);
}
