'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_KEY = 'koya-booking-9f3c2f1a7d5e6b4c';

type Slot = { id: string; provider: string; start: string; end: string; available: boolean };
type Booking = { id: string; slot_id: string; name: string; email: string; status: string; created_at: string };
type Banner = { kind: 'ok' | 'err' | ''; text: string };

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : timeFmt.format(d);
}

function durationMin(start: string, end: string): number | null {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : null;
}

export default function Home() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: '', text: '' });
  const [lastBooking, setLastBooking] = useState<Booking | null>(null);
  const [lookupEmail, setLookupEmail] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [lookupDone, setLookupDone] = useState(false);

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    try {
      const res = await fetch('/slots', { headers: { 'X-API-Key': API_KEY } });
      const data = await res.json();
      setSlots(Array.isArray(data.slots) ? data.slots : []);
    } catch {
      setBanner({ kind: 'err', text: 'Could not load slots. Try again.' });
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const selected = useMemo(() => slots.find((s) => s.id === selectedId) ?? null, [slots, selectedId]);

  const groups = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = fmtDate(s.start);
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [slots]);

  const openCount = slots.filter((s) => s.available).length;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) {
      setBanner({ kind: 'err', text: 'Pick an open slot first.' });
      return;
    }
    setBusy(true);
    setBanner({ kind: '', text: '' });
    try {
      const res = await fetch('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ slot_id: selected.id, name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'err', text: data?.error || 'Booking failed.' });
        await loadSlots();
        return;
      }
      setLastBooking(data as Booking);
      setSelectedId('');
      setLookupEmail(data.email);
      setBookings([]);
      setLookupDone(false);
      await loadSlots();
    } catch {
      setBanner({ kind: 'err', text: 'Network error. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function findBookings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = (lookupEmail.trim() || email.trim()).toLowerCase();
    if (!target) {
      setBanner({ kind: 'err', text: 'Enter the email used for the booking.' });
      return;
    }
    setBanner({ kind: '', text: '' });
    try {
      const res = await fetch(`/bookings?email=${encodeURIComponent(target)}&limit=50`, {
        headers: { 'X-API-Key': API_KEY },
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'err', text: data?.error || 'Lookup failed.' });
        return;
      }
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setLookupDone(true);
    } catch {
      setBanner({ kind: 'err', text: 'Network error. Try again.' });
    }
  }

  async function cancelBooking(id: string) {
    try {
      const res = await fetch(`/bookings/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': API_KEY },
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'err', text: data?.error || 'Could not cancel that booking.' });
        return;
      }
      setBanner({ kind: 'ok', text: 'Booking cancelled and the slot is open again.' });
      setBookings((prev) => prev.map((b) => (b.id === id ? (data as Booking) : b)));
      await loadSlots();
    } catch {
      setBanner({ kind: 'err', text: 'Network error. Try again.' });
    }
  }

  function resetForm() {
    setLastBooking(null);
    setSelectedId('');
    setName('');
    setEmail('');
    setBanner({ kind: '', text: '' });
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-text">
            <strong>Koya Clinic</strong>
            <small>Appointments</small>
          </span>
        </div>
        <div className="topbar-meta">
          <span className="pill pill-live">
            <i aria-hidden="true" />
            Booking open
          </span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Clinic appointments</p>
          <h1>Book your visit in under a minute.</h1>
          <p className="lede">
            Choose an open slot, confirm your details, and get an instant booking reference. Cancel any time —
            no account needed.
          </p>
          <ul className="hero-points">
            <li>Instant confirmation</li>
            <li>Free cancellation</li>
            <li>30-minute visits</li>
          </ul>
        </div>
        <div className="hero-card" aria-live="polite">
          <span className="hero-card-label">Open slots</span>
          <strong className="hero-count">{slotsLoading ? '—' : openCount}</strong>
          <span className="hero-card-foot">
            {slots.length} listed · live availability
          </span>
        </div>
      </section>

      {banner.text ? (
        <div className={`banner ${banner.kind}`} role="status">
          {banner.text}
        </div>
      ) : null}

      <div className="grid">
        <section className="panel" aria-labelledby="slots-heading">
          <div className="panel-head">
            <h2 id="slots-heading">Available times</h2>
            <button className="text-btn" type="button" onClick={() => void loadSlots()}>
              Refresh
            </button>
          </div>

          {slotsLoading ? (
            <p className="muted">Loading slots…</p>
          ) : groups.length === 0 ? (
            <div className="empty">
              <strong>No slots published yet</strong>
              <p>Slots will appear here as soon as the clinic adds them.</p>
            </div>
          ) : (
            groups.map(([day, items]) => (
              <div className="day" key={day}>
                <h3 className="day-label">{day}</h3>
                <div className="slot-list">
                  {items.map((s) => {
                    const isSelected = s.id === selectedId;
                    const mins = durationMin(s.start, s.end);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`slot${isSelected ? ' slot-selected' : ''}${!s.available ? ' slot-booked' : ''}`}
                        onClick={() => setSelectedId(s.id)}
                        disabled={!s.available}
                        aria-pressed={isSelected}
                      >
                        <span className="slot-time">
                          {fmtTime(s.start)}<span className="dash">–</span>{fmtTime(s.end)}
                        </span>
                        <span className="slot-provider">{s.provider}</span>
                        <span className="slot-dur">{mins ? `${mins} min` : '—'}</span>
                        <span className={`pill ${s.available ? 'pill-ok' : 'pill-off'}`}>
                          {s.available ? 'Open' : 'Booked'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>

        <aside className="panel form-panel">
          {lastBooking ? (
            <div className="success">
              <div className="success-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2>You&apos;re booked</h2>
              <p className="muted">Keep this reference for your visit.</p>
              <dl className="summary">
                <div>
                  <dt>Reference</dt>
                  <dd className="mono">{lastBooking.id}</dd>
                </div>
                <div>
                  <dt>Name</dt>
                  <dd>{lastBooking.name}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{lastBooking.email}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{lastBooking.status}</dd>
                </div>
              </dl>
              <button className="btn" type="button" onClick={resetForm}>
                Book another slot
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h2>Your details</h2>
              <div className={`selected-slot${selected ? ' has-slot' : ''}`}>
                {selected ? (
                  <>
                    <span className="muted">Selected slot</span>
                    <strong>
                      {fmtDate(selected.start)} · {fmtTime(selected.start)}–{fmtTime(selected.end)}
                    </strong>
                    <span className="muted">{selected.provider}</span>
                  </>
                ) : (
                  <span className="muted">Choose a slot on the left to continue.</span>
                )}
              </div>

              <label htmlFor="name">Full name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Obi"
                autoComplete="name"
                required
              />

              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ada@example.com"
                autoComplete="email"
                inputMode="email"
                required
              />

              <button className="btn" type="submit" disabled={!selected || !name.trim() || !email.trim() || busy}>
                {busy ? 'Confirming…' : 'Confirm booking'}
              </button>
              <p className="fineprint">You&apos;ll get a reference immediately. No payment is taken here.</p>
            </form>
          )}
        </aside>
      </div>

      <section className="panel lookup" aria-labelledby="lookup-heading">
        <div className="panel-head">
          <h2 id="lookup-heading">Your bookings</h2>
        </div>
        <form className="lookup-form" onSubmit={findBookings}>
          <input
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            placeholder="Email used for booking"
            aria-label="Email used for booking"
            inputMode="email"
          />
          <button className="btn secondary" type="submit">
            Find bookings
          </button>
        </form>

        {lookupDone && bookings.length === 0 ? <p className="muted">No bookings found for that email.</p> : null}

        {bookings.length > 0 ? (
          <ul className="booking-list">
            {bookings.map((b) => (
              <li key={b.id}>
                <div className="booking-main">
                  <strong className="mono">{b.id}</strong>
                  <span className="muted">
                    {fmtDate(b.created_at)} · slot {b.slot_id}
                  </span>
                </div>
                <div className="booking-actions">
                  <span className={`pill ${b.status === 'confirmed' ? 'pill-ok' : 'pill-off'}`}>{b.status}</span>
                  {b.status === 'confirmed' ? (
                    <button className="text-btn danger" type="button" onClick={() => void cancelBooking(b.id)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <footer className="foot">
        <span>Koya Clinic · booking desk</span>
        <span>Nigeria · NGN</span>
      </footer>
    </div>
  );
}
