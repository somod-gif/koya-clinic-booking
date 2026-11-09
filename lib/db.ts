import { neon } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';

export const API_KEY = process.env.API_KEY || 'koya-booking-9f3c2f1a7d5e6b4c';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local (local) or the deployment environment.');
}

export const sql = neon(DATABASE_URL);

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        slot_start TEXT NOT NULL,
        slot_end TEXT NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_confirmed_slot
        ON bookings (slot_id) WHERE status = 'confirmed'`;
      await sql`CREATE TABLE IF NOT EXISTS idempotency_keys (
        idem_key TEXT PRIMARY KEY,
        body_hash TEXT NOT NULL,
        status INTEGER NOT NULL,
        booking_id TEXT
      )`;
      await sql`CREATE TABLE IF NOT EXISTS rate_attempts (
        email TEXT NOT NULL,
        minute_start BIGINT NOT NULL,
        attempts INTEGER NOT NULL,
        PRIMARY KEY (email, minute_start)
      )`;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export function bodyHash(body: Record<string, unknown>): string {
  const normalized = JSON.stringify({
    slot_id: body && body.slot_id !== undefined ? String(body.slot_id).trim() : null,
    name: body && body.name !== undefined ? String(body.name).trim() : null,
    email: body && body.email !== undefined ? String(body.email).trim().toLowerCase() : null,
  });
  return createHash('sha256').update(normalized).digest('hex');
}

export function newBookingId(): string {
  return `bk_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

export async function getBooking(id: string): Promise<any | null> {
  await ensureSchema();
  const rows = await sql`SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function getSlot(id: string): Promise<any | null> {
  await ensureSchema();
  const rows = await sql`SELECT id, provider, slot_start AS start, slot_end AS "end" FROM slots WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function findConfirmedBySlot(slotId: string): Promise<any | null> {
  await ensureSchema();
  const rows = await sql`SELECT id, slot_id, name, email, status, created_at FROM bookings
    WHERE slot_id = ${slotId} AND status = 'confirmed'
    ORDER BY created_at DESC, id DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function listBookings(
  email: string,
  limit: number,
  cursor: string | null,
): Promise<{ bookings: any[]; next_cursor: string | null }> {
  await ensureSchema();
  let rows: any[] = [];

  if (cursor) {
    const anchor = await sql`SELECT created_at, id FROM bookings WHERE email = ${email} AND id = ${cursor}`;
    if (anchor.length > 0) {
      rows = await sql`SELECT id, slot_id, name, email, status, created_at FROM bookings
        WHERE email = ${email}
          AND (created_at > ${anchor[0].created_at}
            OR (created_at = ${anchor[0].created_at} AND id > ${anchor[0].id}))
        ORDER BY created_at ASC, id ASC LIMIT ${limit}`;
    }
  } else {
    rows = await sql`SELECT id, slot_id, name, email, status, created_at FROM bookings
      WHERE email = ${email} ORDER BY created_at ASC, id ASC LIMIT ${limit}`;
  }

  let next_cursor: string | null = null;
  if (rows.length >= limit) {
    const last = rows[rows.length - 1];
    const next = await sql`SELECT id FROM bookings
      WHERE email = ${email}
        AND (created_at > ${last.created_at}
          OR (created_at = ${last.created_at} AND id > ${last.id}))
      ORDER BY created_at ASC, id ASC LIMIT 1`;
    next_cursor = next.length > 0 ? String(next[0].id) : null;
  }

  return { bookings: rows, next_cursor };
}

export async function rateBucket(email: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
  await ensureSchema();
  const now = Date.now();
  const minuteStart = Math.floor(now / 60000) * 60000;
  const rows = await sql`SELECT attempts FROM rate_attempts WHERE email = ${email} AND minute_start = ${minuteStart}`;
  const attempts = rows.length > 0 ? Number(rows[0].attempts) : 0;
  const blocked = attempts >= 5;
  if (!blocked) {
    await sql`INSERT INTO rate_attempts (email, minute_start, attempts) VALUES (${email}, ${minuteStart}, 1)
      ON CONFLICT (email, minute_start) DO UPDATE SET attempts = rate_attempts.attempts + 1`;
  }
  const retryAfterSec = Math.max(1, Math.ceil((minuteStart + 60000 - now) / 1000));
  return { blocked, retryAfterSec };
}

export async function clearRateBucket(email: string): Promise<void> {
  await ensureSchema();
  const minuteStart = Math.floor(Date.now() / 60000) * 60000;
  await sql`DELETE FROM rate_attempts WHERE email = ${email} AND minute_start = ${minuteStart}`;
}

export function resetAll(): Promise<unknown[]> {
  return ensureSchema().then(() =>
    Promise.all([
      sql`DELETE FROM bookings`,
      sql`DELETE FROM slots`,
      sql`DELETE FROM idempotency_keys`,
      sql`DELETE FROM rate_attempts`,
    ]),
  );
}
