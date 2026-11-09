# Koya — Clinic Booking API (Task 1)

Clinic booking API built with **Next.js full stack** (App Router) and **Neon Postgres** for the Koya Cohort 4 assessment.

- **Local API:** `http://localhost:4321/api`
- **Web page:** `http://localhost:4321/`
- **Stack:** Next.js 16 (route handlers + React client page), TypeScript, `@neondatabase/serverless` over Neon's HTTP driver

## Run locally

```bash
cd koya-task/booking
npm install
# .env.local must contain DATABASE_URL (see .env.example)
node --env-file=.env.local scripts/check-db.mjs   # creates schema + proves connectivity
npm run dev
```

Environment variables:

| Var | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | Neon Postgres connection string (pooled). Required. |
| `PORT` | `4321` | Server port. |
| `API_KEY` | `koya-booking-9f3c2f1a7d5e6b4c` | Key the grader sends in `X-API-Key`. |

## API

All endpoints require `X-API-Key` (missing/wrong → `401 {"error": "..."}`).

| Method | Path | Level | Purpose |
| --- | --- | --- | --- |
| POST | `/api/reset` | 1 | Body `{ "slots": [{ "id", "provider", "start", "end" }] }` — deletes all bookings/slots and replaces slots (incl. past). |
| GET | `/api/slots` | 1 | `?provider=` exact filter → `{ slots: [{ id, provider, start, end, available }] }`, earliest start first. |
| POST | `/api/bookings` | 1–5 | Body `{ slot_id, name, email }`. L1 → 201 confirmed. L2 → 400 missing/invalid/started, 404 unknown slot. L3 → 409 already booked (DB-enforced unique index). L4 → `Idempotency-Key`: same key+body → same response; different body → 422. L5 → 5 attempts/email/minute → 429 + `Retry-After`. |
| GET | `/api/bookings?email=&limit=&cursor=` | 4 | Person's bookings, oldest first, cursor pagination. `limit` 1–50 (default 10, else 400). |
| GET | `/api/bookings/[id]` | 1 | 200 / 404. |
| DELETE | `/api/bookings/[id]` | 3 | Cancel → `cancelled`, frees slot. 200 / 404 / 409. |

Booking object: `{ id, slot_id, name, email, status, created_at }`.

## Database

Neon Postgres, schema auto-created on first request (`ensureSchema()` in `lib/db.ts`):

- `slots (id, provider, slot_start, slot_end)`
- `bookings (id, slot_id, name, email, status, created_at)` + partial unique index `ux_bookings_confirmed_slot` on `slot_id WHERE status = 'confirmed'` (makes double-booking impossible under concurrency)
- `idempotency_keys (idem_key, body_hash, status, booking_id)`
- `rate_attempts (email, minute_start, attempts)`

`POST /api/reset` clears all four tables so runs are repeatable.

## Tests

```bash
npm run dev            # or: npm run build && npm run start
node test.js
```

Covers all five levels against the running server. Latest run: **28/28 PASS** (dev and production build, Neon-backed).

## Deploy

`render.yaml` + `Dockerfile` are included. Set `DATABASE_URL` (and optionally `API_KEY`) in the host's environment; build with `npm run build`, start with `npm run start`.
