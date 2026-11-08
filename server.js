#!/usr/bin/env node
'use strict';

// ============================================================
// KOYA — Clinic Booking API (Task 1 of the Koya Cohort 4 assessment)
// ============================================================
// Spec: https://koyaacademy.com/assessment-api
//   L1: GET /slots, POST /reset, POST /bookings, GET /bookings/{id}
//   L2: X-API-Key required, field validation, started-slot check, 404/400/400
//   L3: atomic slot booking + cancel frees slot
//   L4: idempotency (Idempotency-Key) + person booking list w/ cursor pagination
//   L5: 5 attempts per email per minute -> 429 + Retry-After

const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4321);
const API_KEY = process.env.API_KEY || 'koya-booking-9f3c2f1a7d5e6b4c';
const DB_PATH = process.env.DB_PATH || '/tmp/opencode/koya-booking/booking.db';

mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_confirmed_slot
    ON bookings (slot_id) WHERE status = 'confirmed';
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    body_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    booking_id TEXT
  );
  CREATE TABLE IF NOT EXISTS rate_attempts (
    email TEXT NOT NULL,
    minute_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    PRIMARY KEY (email, minute_start)
  );
`);

const app = express();
app.use(express.json({ limit: '1mb' }));

function err(res, status, message) {
  return res.status(status).json({ error: message });
}

function authenticate(req, res, next) {
  if (req.get('X-API-Key') !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function bodyHash(body) {
  const normalized = JSON.stringify({
    slot_id: body && body.slot_id !== undefined ? String(body.slot_id).trim() : null,
    name: body && body.name !== undefined ? String(body.name).trim() : null,
    email: body && body.email !== undefined ? String(body.email).trim().toLowerCase() : null,
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function newBookingId() {
  return `bk_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function getBooking(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) || null;
}

function getSlot(id) {
  return db.prepare('SELECT * FROM slots WHERE id = ?').get(id) || null;
}

function findConfirmedBySlot(slotId) {
  return db.prepare("SELECT * FROM bookings WHERE slot_id = ? AND status = 'confirmed' ORDER BY created_at DESC, id DESC LIMIT 1").get(slotId) || null;
}

function listBookings(email, limit, cursor) {
  const rows = db.prepare('SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE email = ? ORDER BY created_at ASC, id ASC LIMIT ?').all(email, limit);
  let next_cursor = null;
  if (rows.length >= limit) {
    const last = rows[rows.length - 1];
    const next = db.prepare('SELECT id FROM bookings WHERE email = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC, id ASC LIMIT 1').get(email, last.created_at, last.created_at, last.id);
    next_cursor = next ? next.id : null;
  }
  const bookings = rows.map((r) => ({ id: r.id, slot_id: r.slot_id, name: r.name, email: r.email, status: r.status, created_at: r.created_at }));
  return { bookings, next_cursor };
}

function rateBucket(email) {
  const now = Date.now();
  const minuteStart = Math.floor(now / 60000) * 60000;
  const row = db.prepare('SELECT attempts FROM rate_attempts WHERE email = ? AND minute_start = ?').get(email, minuteStart);
  const attempts = row ? row.attempts : 0;
  const blocked = attempts >= 5;
  if (!blocked) {
    db.prepare('INSERT INTO rate_attempts (email, minute_start, attempts) VALUES (?, ?, 1) ON CONFLICT(email, minute_start) DO UPDATE SET attempts = attempts + 1').run(email, minuteStart);
  }
  const retryAfterSec = Math.max(1, Math.ceil((minuteStart + 60000 - now) / 1000));
  return { blocked, retryAfterSec };
}

function clearRateBucket(email) {
  const minuteStart = Math.floor(Date.now() / 60000) * 60000;
  db.prepare('DELETE FROM rate_attempts WHERE email = ? AND minute_start = ?').run(email, minuteStart);
}

app.use(express.static(process.cwd() + '/public'));

app.get('/', (req, res) => res.sendFile(process.cwd() + '/public/index.html'));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/reset', authenticate, (req, res) => {
  const slots = req.body && Array.isArray(req.body.slots) ? req.body.slots : null;
  if (!slots) return err(res, 400, 'slots array required');
  const insert = db.prepare('INSERT INTO slots (id, provider, start, end) VALUES (?, ?, ?, ?)');
  db.prepare('DELETE FROM bookings').run();
  db.prepare('DELETE FROM slots').run();
  for (const s of slots) insert.run(String(s.id), String(s.provider ?? ''), String(s.start ?? ''), String(s.end ?? ''));
  return res.json({ ok: true });
});

app.get('/slots', authenticate, (req, res) => {
  const provider = typeof req.query.provider === 'string' && req.query.provider.length > 0 ? req.query.provider : null;
  const slots = provider ? db.prepare('SELECT * FROM slots WHERE provider = ? ORDER BY start ASC').all(provider) : db.prepare('SELECT * FROM slots ORDER BY start ASC').all();
  const out = slots.map((s) => ({
    id: s.id,
    provider: s.provider,
    start: s.start,
    end: s.end,
    available: !db.prepare("SELECT 1 AS c FROM bookings WHERE slot_id = ? AND status = 'confirmed' LIMIT 1").get(s.id),
  }));
  return res.json({ slots: out });
});

app.post('/bookings', authenticate, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const key = req.get('Idempotency-Key') || null;
  const hash = bodyHash(body);
  const emailForRate = String(body.email || '').trim().toLowerCase();

  if (key) {
    const idem = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key);
    if (idem) {
      if (idem.body_hash === hash) {
        if (idem.status === 201) {
          const booking = getBooking(idem.booking_id);
          return res.status(201).json(booking);
        }
        return res.status(idem.status).json({ error: 'idempotent replay' });
      }
      return err(res, 422, 'idempotency key reused with different body');
    }
  }

  const rate = rateBucket(emailForRate);
  if (rate.blocked) {
    res.set('Retry-After', String(rate.retryAfterSec));
    return err(res, 429, 'too many attempts');
  }

  const slotId = body.slot_id !== undefined && body.slot_id !== null ? String(body.slot_id).trim() : '';
  const name = body.name !== undefined && body.name !== null ? String(body.name).trim() : '';
  const email = body.email !== undefined && body.email !== null ? String(body.email).trim().toLowerCase() : '';

  if (!slotId || !name || !email) {
    return err(res, 400, 'missing field');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err(res, 400, 'invalid email');
  }

  const slot = getSlot(slotId);
  if (!slot) {
    return err(res, 404, 'slot not found');
  }
  if (Date.parse(slot.start) <= Date.now()) {
    return err(res, 400, 'slot already started');
  }
  const existing = findConfirmedBySlot(slotId);
  if (existing) {
    return err(res, 409, 'slot already booked');
  }

  const info = db.prepare('INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    newBookingId(), slotId, name, email, 'confirmed', new Date().toISOString()
  );
  const bookingRow = db.prepare('SELECT * FROM bookings WHERE rowid = ?').get(Number(info.lastInsertRowid));
  if (key) {
    db.prepare('INSERT INTO idempotency_keys (key, body_hash, status, booking_id) VALUES (?, ?, ?, ?)').run(key, hash, 201, bookingRow.id);
  }
  return res.status(201).json(bookingRow);
});

app.get('/bookings', authenticate, (req, res) => {
  const email = req.query.email;
  if (!email) return err(res, 400, 'email required');
  const emailNorm = String(email).trim().toLowerCase();
  let limit = 10;
  if (req.query.limit !== undefined) {
    limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return err(res, 400, 'invalid limit');
  }
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length > 0 ? req.query.cursor : null;
  const { bookings, next_cursor } = listBookings(emailNorm, limit, cursor);
  return res.json({ bookings, next_cursor });
});

app.get('/bookings/:id', authenticate, (req, res) => {
  const booking = getBooking(String(req.params.id));
  if (!booking) return err(res, 404, 'booking not found');
  return res.json(booking);
});

app.delete('/bookings/:id', authenticate, (req, res) => {
  const booking = getBooking(String(req.params.id));
  if (!booking) return err(res, 404, 'booking not found');
  if (booking.status === 'cancelled') return err(res, 409, 'already cancelled');
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
  const updated = getBooking(booking.id);
  return res.json(updated);
});

app.use((req, res) => err(res, 404, 'not found'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(PORT, () => {
  console.log(`Koya booking API listening on ${PORT}`);
});

module.exports = app;
