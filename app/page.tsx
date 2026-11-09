'use client';

import { useEffect, useState } from 'react';

const API_KEY = 'koya-booking-9f3c2f1a7d5e6b4c';

export default function Home() {
  const [slots, setSlots] = useState<any[]>([]);
  const [banner, setBanner] = useState<{ kind: string; text: string }>({ kind: '', text: '' });
  const [slotId, setSlotId] = useState('');
  const [bkName, setBkName] = useState('');
  const [bkEmail, setBkEmail] = useState('');
  const [confirm, setConfirm] = useState<any>(null);
  const [myBookings, setMyBookings] = useState<any[]>([]);

  async function refreshSlots() {
    try {
      const res = await fetch('/api/slots', { headers: { 'X-API-Key': API_KEY } });
      const data = await res.json();
      setSlots(data.slots || []);
    } catch (e: any) {
      setBanner({ kind: 'err', text: String(e?.message || e) });
    }
  }

  useEffect(() => {
    void refreshSlots();
  }, []);

  async function book() {
    setBanner({ kind: '', text: '' });
    setConfirm(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, 'Idempotency-Key': 'web-' + bkEmail.trim().toLowerCase() + '-' + slotId },
        body: JSON.stringify({ slot_id: slotId, name: bkName.trim(), email: bkEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfirm(data);
        setBanner({ kind: 'ok', text: 'Booked successfully.' });
        void refreshSlots();
      } else {
        setBanner({ kind: 'err', text: data.error || 'Booking failed' });
      }
    } catch (e: any) {
      setBanner({ kind: 'err', text: String(e?.message || e) });
    }
  }

  async function myBookingsList() {
    const email = bkEmail.trim().toLowerCase();
    if (!email) {
      setBanner({ kind: 'err', text: 'Enter your email first' });
      return;
    }
    const res = await fetch('/api/bookings?email=' + encodeURIComponent(email), { headers: { 'X-API-Key': API_KEY } });
    const data = await res.json();
    setMyBookings(data.bookings || []);
    setConfirm({ bookings: data.bookings || [] });
  }

  return (
    <main>
      <h1>Clinic booking</h1>
      <p className="sub">Book a slot with the clinic. This page talks to the booking API.</p>
      {banner.kind ? <div className={'banner ' + banner.kind}>{banner.text}</div> : null}
      <section>
        <h2>Available slots</h2>
        {slots.length === 0 ? <p className="empty">No slots available.</p> : null}
        {slots.map((s) => (
          <div className="card slot" key={s.id}>
            <div>
              <div className="when">{s.start} → {s.end}</div>
              <div className="who">{s.provider}</div>
            </div>
            <button className="btn" disabled={!s.available} onClick={() => { setSlotId(s.id); setConfirm(null); }}>
              {s.available ? 'Book' : 'Booked'}
            </button>
          </div>
        ))}
      </section>
      <section>
        <h2>Book a slot</h2>
        <label htmlFor="slotId">Slot</label>
        <select id="slotId" value={slotId} onChange={(e) => { setSlotId(e.target.value); setConfirm(null); }}>
          <option value="">Select a slot</option>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.provider} · {s.start}
            </option>
          ))}
        </select>
        <label htmlFor="bkName">Name</label>
        <input id="bkName" value={bkName} onChange={(e) => setBkName(e.target.value)} placeholder="Ada Obi" autoComplete="name" />
        <label htmlFor="bkEmail">Email</label>
        <input id="bkEmail" value={bkEmail} onChange={(e) => setBkEmail(e.target.value)} placeholder="ada@example.com" autoComplete="email" inputMode="email" />
        <button className="btn" onClick={() => void book()} disabled={!slotId || !bkName.trim() || !bkEmail.trim()}>
          Book
        </button>
        <button className="btn ghost" onClick={() => void myBookingsList()}>
          My bookings
        </button>
        {confirm ? (
          <div className="card">
            {confirm.bookings ? (
              <div>Your recent bookings: {confirm.bookings.length}</div>
            ) : (
              <div>Booked! Reference: <strong>{confirm.id}</strong> — status {confirm.status}.</div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
