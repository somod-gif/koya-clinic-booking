// Local smoke test for the Koya clinic booking API.
// Run with: node test.js  (against http://localhost:3000)
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const KEY = 'koya-booking-9f3c2f1a7d5e6b4c';
// Unique per run so a browser booking through the live UI can't collide with these ids.
const RUN = Date.now().toString(36);
const S1 = `s1_${RUN}`;
const S2 = `s2_${RUN}`;
const S3 = `s3_${RUN}`;
const S4 = `s4_${RUN}`;
const PAST = `past_${RUN}`;
const results = [];

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, retryAfter: res.headers.get('retry-after') };
}

function check(name, cond, extra) { results.push({ name, pass: !!cond, extra }); }

(async () => {
  let r = await call('POST', '/reset', { slots: [
    { id: S1, provider: 'Dr Ade', start: '2026-12-10T09:00:00Z', end: '2026-12-10T09:30:00Z' },
    { id: S2, provider: 'Dr Bola', start: '2026-12-11T10:00:00Z', end: '2026-12-11T10:30:00Z' },
  ] });
  check('L1 reset returns 200', r.status === 200, r);

  r = await call('GET', '/slots');
  check('L1 GET /slots returns 2 slots', r.status === 200 && r.json.slots.length === 2, r.json);
  check('L1 slots have available true', r.json.slots.every((s) => s.available === true));
  r = await call('GET', '/slots?provider=Dr Ade');
  check('L1 slots filter by provider', r.status === 200 && r.json.slots.length === 1 && r.json.slots[0].id === S1, r.json);

  const noKey = await fetch(BASE + '/slots');
  check('L2 missing api key returns 401', noKey.status === 401);

  r = await call('POST', '/bookings', { slot_id: S1 });
  check('L2 missing name/email -> 400', r.status === 400, r);
  r = await call('POST', '/bookings', { slot_id: S1, name: 'Ada', email: 'not-an-email' });
  check('L2 invalid email -> 400', r.status === 400, r);
  r = await call('POST', '/bookings', { slot_id: 'nope', name: 'Ada', email: 'ada@example.com' });
  check('L2 unknown slot -> 404', r.status === 404, r);

  r = await call('POST', '/bookings', { slot_id: S1, name: '  Ada Obi ', email: '  ADA@Example.COM ' });
  check('L1 book returns 201 confirmed', r.status === 201 && r.json.status === 'confirmed', r);
  const bookingId = r.json.id;

  r = await call('GET', '/bookings/' + bookingId);
  check('L1 get booking returns booking', r.status === 200 && r.json.email === 'ada@example.com' && r.json.name === 'Ada Obi', r.json);
  r = await call('GET', '/bookings/does-not-exist');
  check('L1 get booking 404', r.status === 404, r);

  r = await call('POST', '/bookings', { slot_id: S1, name: 'Bob', email: 'bob@example.com' });
  check('L3 double booking -> 409', r.status === 409, r);

  r = await call('DELETE', '/bookings/' + bookingId);
  check('L3 cancel returns booking', r.status === 200 && r.json.status === 'cancelled', r);
  r = await call('DELETE', '/bookings/' + bookingId);
  check('L3 cancel twice -> 409', r.status === 409, r);
  r = await call('POST', '/bookings', { slot_id: S1, name: 'Ada Obi', email: 'ada@example.com' });
  check('L3 rebook after cancel -> 201', r.status === 201, r);

  // L2: slot already started (past slot) -> 400; then restore slots
  r = await call('POST', '/reset', { slots: [ { id: PAST, provider: 'Dr Past', start: '2026-01-01T09:00:00Z', end: '2026-01-01T09:30:00Z' } ] });
  r = await call('POST', '/bookings', { slot_id: PAST, name: 'Ada', email: 'ada@example.com' });
  check('L2 past slot -> 400', r.status === 400, r);
  r = await call('POST', '/reset', { slots: [
    { id: S1, provider: 'Dr Ade', start: '2026-12-10T09:00:00Z', end: '2026-12-10T09:30:00Z' },
    { id: S2, provider: 'Dr Bola', start: '2026-12-11T10:00:00Z', end: '2026-12-11T10:30:00Z' },
  ] });

  // L4: idempotency
  r = await call('POST', '/bookings', { slot_id: S2, name: 'Idem User', email: 'idem@example.com' }, { 'Idempotency-Key': 'idem-key-1' });
  check('L4 first book 201', r.status === 201, r);
  const idemBookingId = r.json.id;
  r = await call('POST', '/bookings', { slot_id: S2, name: 'Idem User', email: 'idem@example.com' }, { 'Idempotency-Key': 'idem-key-1' });
  check('L4 idempotent replay same response', r.status === 201 && r.json.id === idemBookingId, r);
  r = await call('POST', '/bookings', { slot_id: S2, name: 'Idem User 2', email: 'idem@example.com' }, { 'Idempotency-Key': 'idem-key-1' });
  check('L4 same key different body -> 422', r.status === 422, r);

  // L4: list bookings
  r = await call('GET', '/bookings?email=idem@example.com&limit=10');
  check('L4 list returns booking page', r.status === 200 && Array.isArray(r.json.bookings) && r.json.bookings.length === 1, r.json);
  check('L4 list next_cursor null on last page', r.json.next_cursor === null, r.json);
  r = await call('GET', '/bookings?email=idem@example.com&limit=0');
  check('L4 invalid limit -> 400', r.status === 400, r);
  r = await call('GET', '/bookings?email=idem@example.com&limit=51');
  check('L4 limit 51 -> 400', r.status === 400, r);
  r = await call('GET', '/bookings');
  check('L4 missing email -> 400', r.status === 400, r);

  // L5: rate limit — rl@example.com: 5 attempts ok, 6th -> 429
  r = await call('POST', '/reset', { slots: [ { id: S3, provider: 'Dr Zed', start: '2026-12-12T09:00:00Z', end: '2026-12-12T09:30:00Z' } ] });
  const rlStatuses = [];
  for (let i = 0; i < 6; i++) {
    const rr = await call('POST', '/bookings', { slot_id: S3, name: 'Rate User ' + i, email: 'rl@example.com' });
    rlStatuses.push(rr.status);
  }
  check('L5 5 attempts ok, 6th -> 429', rlStatuses.join(',') === '201,409,409,409,409,429', rlStatuses);
  const rr429 = rlStatuses[5] === 429 ? await call('POST', '/bookings', { slot_id: S3, name: 'Rate User 99', email: 'rl@example.com' }) : null;
  check('L5 429 carries Retry-After', !!rr429 && Number(rr429.retryAfter) > 0, rr429);

  r = await call('POST', '/bookings', { slot_id: S3, name: 'Other User', email: 'other@example.com' });
  check('L5 other email unaffected', r.status === 409, r);

  // L1: reset clears bookings
  r = await call('POST', '/reset', { slots: [ { id: S4, provider: 'Dr Final', start: '2026-12-13T09:00:00Z', end: '2026-12-13T09:30:00Z' } ] });
  r = await call('GET', '/bookings?email=idem@example.com');
  check('L1 reset clears bookings', Array.isArray(r.json.bookings) && r.json.bookings.length === 0, r.json);

  for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + ' :: ' + JSON.stringify(x.extra ?? null).slice(0, 300));
  const failed = results.filter((x) => !x.pass).length;
  console.log('TOTAL ' + results.length + ' FAILED ' + failed);
})().catch((e) => { console.log('TEST_ERROR ' + e.message); process.exit(1); });
