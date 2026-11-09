// Creates the booking schema on Neon and proves connectivity.
// Run: node --env-file=.env.local scripts/check-db.mjs
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Pass --env-file=.env.local or export it.');
  process.exit(1);
}

const sql = neon(url);

const info = await sql`SELECT current_database() AS db, split_part(version(), ',', 1) AS version`;
console.log('CONNECTED_TO', info[0].db);
console.log('SERVER', info[0].version);

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
await sql`DROP TABLE IF EXISTS rate_attempts`;
await sql`CREATE TABLE IF NOT EXISTS rate_attempts (
  email TEXT NOT NULL,
  minute_start BIGINT NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (email, minute_start)
)`;

const tables = await sql`SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`;
console.log('TABLES', tables.map((t) => t.table_name).join(', '));

const counts = await sql`SELECT
  (SELECT COUNT(*)::int FROM slots) AS slots,
  (SELECT COUNT(*)::int FROM bookings) AS bookings`;
console.log('COUNTS', JSON.stringify(counts[0]));

// Prove a write + read round trip, then roll it back out.
const marker = `probe_${Date.now()}`;
await sql`INSERT INTO slots (id, provider, slot_start, slot_end)
  VALUES (${marker}, 'Dr Probe', '2030-01-01T09:00:00Z', '2030-01-01T09:30:00Z')`;
const readBack = await sql`SELECT id, provider FROM slots WHERE id = ${marker}`;
console.log('ROUND_TRIP', JSON.stringify(readBack[0]));
await sql`DELETE FROM slots WHERE id = ${marker}`;
console.log('SCHEMA_READY');
