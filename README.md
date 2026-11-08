# Koya — Clinic Booking API (Task 1)

Clinic booking API built for the Koya Cohort 4 assessment.

- **Live API (local):** `http://localhost:4321`
- **Web page:** `http://localhost:4321/`

## Run locally

```bash
cd koya-task/booking
npm install
node server.js
```

Environment variables:

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `4321` | |
| `API_KEY` | `koya-booking-9f3c2f1a7d5e6b4c` | The key the graders send in `X-API-Key`. |
| `DB_PATH` | `/tmp/opencode/koya-booking/booking.db` | SQLite file. |

## API

All endpoints require `X-API-Key` (missing/wrong → `401 {"error": "..."}`).

| Method | Path | Level | Purpose |
| --- | --- | --- | --- |
| POST | `/reset` | 1 | Body `{ "slots": [{ "id", "provider", "start", "end" }] }` — deletes all bookings, replaces slots (incl. past). |
| GET | `/slots` | 1 | `GET /slots?provider=` → `{ slots: [{ id, provider, start, end, available }] }`, earliest start first. |
| POST | `/bookings` | 1–5 | Body `{ slot_id, name, email }`. L1 → 201 confirmed. L2 → 400 missing/invalid (email format), 404 unknown slot, 400 slot already started. L3 → 409 slot already booked. L4 → `Idempotency-Key` header; same key+body → same response; same key+different body → 422. L5 → max 5 attempts/email/minute (failed included), 6th → 429 + `Retry-After`. |
| GET | `/bookings?email=&limit=&cursor=` | 4 | Person bookings, oldest first, cursor pagination via `next_cursor`. `limit` 1–50 (default 10, else 400). |
| GET | `/bookings/{id}` | 1 | Booking by id. 200 / 404. |
| DELETE | `/bookings/{id}` | 3 | Cancel → status `cancelled`, frees slot. 200 / 404 / 409 (already cancelled). |

Booking object: `{ id, slot_id, name, email, status, created_at }`.

## Tests

```bash
node test.js
```

Covers all five levels locally. Final run: **28/28 PASS**.
