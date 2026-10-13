'use strict';
// Contractor bookings (team, attendance, replacements, cancel) and worker jobs (offers, accept, earnings).
const express = require('express');
const { db } = require('../db');
const { nowIso, todayIST, HttpError, bad } = require('../util');
const auth = require('../auth');
const domain = require('../domain');
const wa = require('../services/whatsapp');

const r = require('../router')();

// ---------- contractor ----------
r.get('/contractor/bookings', auth.requireRole('contractor'), (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings WHERE contractor_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  const today = todayIST();
  const team = db.prepare(`SELECT a.worker_id, a.status, a.paid_confirmation, w.name, w.tier, u.phone,
      (SELECT status FROM attendance t WHERE t.booking_id = a.booking_id AND t.worker_id = a.worker_id AND t.date = ?) AS today
    FROM assignments a JOIN workers w ON w.user_id = a.worker_id JOIN users u ON u.id = a.worker_id
    WHERE a.booking_id = ? AND a.status = 'active' ORDER BY a.assigned_at`);
  res.json({ today, bookings: bookings.map(b => Object.assign(b, { team: team.all(today, b.id) })) });
});

function ownBooking(req) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND contractor_id = ?').get(req.params.id, req.user.id);
  if (!b) throw new HttpError(404, 'Booking not found.', 'not_found');
  return b;
}
function activeAssignment(bookingId, workerId) {
  const a = db.prepare("SELECT * FROM assignments WHERE booking_id = ? AND worker_id = ? AND status = 'active'").get(bookingId, workerId);
  if (!a) throw new HttpError(404, 'This worker is not on the booking.', 'not_found');
  return a;
}

r.post('/contractor/bookings/:id/attendance', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  const status = req.body.status;
  if (!['present', 'late', 'absent'].includes(status)) throw bad('Choose present, late or absent.');
  activeAssignment(b.id, String(req.body.workerId || ''));
  const date = todayIST();
  db.prepare(`INSERT INTO attendance (booking_id, worker_id, date, status, marked_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(booking_id, worker_id, date) DO UPDATE SET status = excluded.status, marked_at = excluded.marked_at`)
    .run(b.id, req.body.workerId, date, status, nowIso());
  res.json({ ok: true });
});

r.post('/contractor/bookings/:id/replace', auth.requireRole('contractor'), async (req, res) => {
  const b = ownBooking(req);
  if (b.status === 'cancelled') throw bad('This booking is cancelled.');
  activeAssignment(b.id, String(req.body.workerId || ''));
  db.transaction(() => {
    db.prepare("UPDATE assignments SET status = 'replaced' WHERE booking_id = ? AND worker_id = ?").run(b.id, req.body.workerId);
    db.prepare("UPDATE bookings SET status = 'open' WHERE id = ? AND status = 'assigned'").run(b.id);
  })();
  const c = domain.getContractor(req.user.id);
  if (domain.contractorPlanActive(c)) await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'replacement', params: { site: b.site } });
  await domain.broadcastJobOffer(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id));
  res.json({ ok: true });
});

r.post('/contractor/bookings/:id/cancel', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  if (b.status === 'cancelled') return res.json({ ok: true });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
  // Refunds for paid bookings are handled by the admin from the Razorpay dashboard.
  res.json({ ok: true, refundNeeded: b.payment_status === 'paid' });
});

// Workers free for this booking line (contractor picks by name).
r.get('/contractor/bookings/:id/available-workers', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  res.json({ workers: b.status === 'open' ? domain.availableWorkers(b) : [], needed: b.count - domain.activeCount(b.id) });
});
r.post('/contractor/bookings/:id/select', auth.requireRole('contractor'), async (req, res) => {
  const out = await domain.selectWorker(req.user.id, req.params.id, String(req.body.workerId || ''));
  res.json(Object.assign({ ok: true }, out));
});
// How many workers are free per skill for these dates (shown on the booking form).
r.get('/contractor/availability', auth.requireRole('contractor'), (req, res) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start || '')) ? String(req.query.start) : todayIST(1);
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 1));
  const level = ['any', 'silver', 'gold'].includes(req.query.level) ? req.query.level : 'any';
  res.json({ counts: domain.availabilityCounts(start, days, level) });
});

// ---------- worker ----------
r.get('/worker/jobs', auth.requireRole('worker'), (req, res) => {
  const w = domain.getWorker(req.user.id);
  if (!w) return res.json({ jobs: [] });
  const jobs = domain.eligibleJobs(w).map(b => ({
    id: b.id, skill_en: b.skill_en, skill_hi: b.skill_hi, skill_mr: b.skill_mr, site: b.site, start_date: b.start_date, days: b.days,
    site_address: b.site_address, site_lat: b.site_lat, site_lng: b.site_lng,
    pay_mode: b.pay_mode, company: b.company, wage: domain.workerDailyWage(w, b), needed: b.count - domain.activeCount(b.id),
  }));
  res.json({ jobs });
});

r.post('/worker/jobs/:id/accept', auth.requireRole('worker'), async (req, res) => {
  const out = await domain.acceptJob(req.user.id, req.params.id);
  res.json(Object.assign({ ok: true }, out));
});

r.get('/worker/work', auth.requireRole('worker'), (req, res) => {
  const w = domain.getWorker(req.user.id);
  if (!w) return res.json({ work: [] });
  const rows = db.prepare(`SELECT b.*, a.paid_confirmation, c.company, u.phone AS contractor_phone FROM assignments a
    JOIN bookings b ON b.id = a.booking_id JOIN contractors c ON c.user_id = b.contractor_id JOIN users u ON u.id = b.contractor_id
    WHERE a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled' ORDER BY b.start_date DESC LIMIT 200`).all(w.user_id);
  res.json({ work: rows.map(b => ({
    id: b.id, skill_en: b.skill_en, skill_hi: b.skill_hi, skill_mr: b.skill_mr, site: b.site, start_date: b.start_date, days: b.days,
    site_address: b.site_address, site_lat: b.site_lat, site_lng: b.site_lng,
    pay_mode: b.pay_mode, company: b.company, contractor_phone: b.contractor_phone, wage: domain.workerDailyWage(w, b), paid_confirmation: b.paid_confirmation,
  })) });
});

r.post('/worker/availability', auth.requireRole('worker'), (req, res) => {
  db.prepare('UPDATE workers SET available = ? WHERE user_id = ?').run(req.body.available ? 1 : 0, req.user.id);
  res.json({ ok: true });
});
r.post('/worker/work/:id/decline', auth.requireRole('worker'), async (req, res) => {
  await domain.declineJob(req.user.id, req.params.id);
  res.json({ ok: true });
});

r.post('/worker/work/:id/paid', auth.requireRole('worker'), async (req, res) => {
  const received = req.body.received === true;
  const row = db.prepare(`SELECT a.*, b.site, b.pay_mode FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE a.booking_id = ? AND a.worker_id = ? AND a.status = 'active'`).get(req.params.id, req.user.id);
  if (!row) throw new HttpError(404, 'Job not found.', 'not_found');
  if (row.pay_mode !== 'direct') throw bad('This job is paid by Labour Katta.');
  db.prepare('UPDATE assignments SET paid_confirmation = ? WHERE booking_id = ? AND worker_id = ?').run(received ? 'yes' : 'no', req.params.id, req.user.id);
  if (!received) {
    const w = domain.getWorker(req.user.id);
    const admins = require('../config').adminPhones;
    for (const phone of admins) await wa.sendTemplate({ userId: null, phone, lang: 'en', templateKey: 'paymentIssue', params: { worker: w.name, site: row.site } });
  }
  res.json({ ok: true });
});

module.exports = r;
