'use strict';
// Contractor bookings (team, attendance, replacements, cancel) and worker jobs (offers, accept, earnings).
const express = require('express');
const { db } = require('../db');
const { nowIso, todayIST, HttpError, bad } = require('../util');
const auth = require('../auth');
const domain = require('../domain');
const wa = require('../services/whatsapp');
const quality = require('../quality');

const r = require('../router')();

// ---------- contractor ----------
r.get('/contractor/bookings', auth.requireRole('contractor'), (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings WHERE contractor_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  const today = todayIST();
  const team = db.prepare(`SELECT a.worker_id, a.status, a.paid_confirmation, a.confirmed_at, w.*, u.phone,
      (SELECT status FROM attendance t WHERE t.booking_id = a.booking_id AND t.worker_id = a.worker_id AND t.date = ?) AS today,
      (SELECT at FROM checkins k WHERE k.booking_id = a.booking_id AND k.worker_id = a.worker_id AND k.date = ?) AS checkin
    FROM assignments a JOIN workers w ON w.user_id = a.worker_id JOIN users u ON u.id = a.worker_id
    WHERE a.booking_id = ? AND a.status = 'active' ORDER BY a.assigned_at`);
  res.json({ today, bookings: bookings.map(b => {
    const t = team.all(today, today, b.id).map(w => {
      const pay = domain.attendancePay(b.id, w.worker_id, domain.workerDailyWage(w, b));
      const rt = db.prepare('SELECT stars, comment, dispute_status FROM ratings WHERE booking_id = ? AND worker_id = ?').get(b.id, w.worker_id) || null;
      const fav = Boolean(db.prepare('SELECT 1 FROM favourites WHERE contractor_id = ? AND worker_id = ?').get(req.user.id, w.worker_id));
      return { worker_id: w.worker_id, status: w.status, paid_confirmation: w.paid_confirmation, confirmed_at: w.confirmed_at, name: w.name, tier: w.tier, phone: w.phone,
        today: w.today, checkin: w.checkin, v: domain.vFlags(w), pay, myRating: rt, favourite: fav, reliability: quality.reliability(w.worker_id), rating: quality.ratingOf(w.worker_id) };
    });
    const end = domain.endDate(b);
    const asks = db.prepare(`SELECT o.id, o.wage, o.travel, o.note, o.created_at, w.* FROM counter_offers o JOIN workers w ON w.user_id = o.worker_id
      WHERE o.booking_id = ? AND o.status = 'pending' ORDER BY o.created_at`).all(b.id)
      .map(o => Object.assign(domain.workerCard(o, b, req.user.id, b), { askId: o.id, askWage: o.wage, askTravel: o.travel, askNote: o.note, stdWage: domain.workerDailyWage(o, b) }));
    return Object.assign(b, { team: t, asks, wagesEarned: t.reduce((s, w) => s + w.pay.earned, 0), end_date: end, ended: end <= today, started: b.start_date <= today, otRateEff: domain.otRate(b, b.wage) });
  }) });
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

/** Mark or correct attendance for a working day up to today, with optional overtime hours. Shared with supervisors. */
function markAttendance(b, body) {
  const status = body.status;
  if (!['present', 'late', 'absent'].includes(status)) throw bad('Choose present, late or absent.');
  const workerId = String(body.workerId || '');
  const a = activeAssignment(b.id, workerId);
  if (a.wages_final_at) throw bad('Wages for this worker are already finalised. Raise a payment dispute to change them.', 'wages_final');
  const date = body.date ? String(body.date) : todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < b.start_date || date > domain.endDate(b) || date > todayIST()) throw bad('Choose a working day of this booking, up to today.', 'bad_date');
  const ot = body.otHours == null || body.otHours === '' ? null : Number(body.otHours);
  if (ot != null && (!Number.isFinite(ot) || ot < 0 || ot > 12)) throw bad('Overtime must be between 0 and 12 hours.');
  const otHours = status === 'absent' ? 0 : ot;
  const note = String(body.note || '').slice(0, 200);
  db.prepare(`INSERT INTO attendance (booking_id, worker_id, date, status, marked_at, ot_hours, note) VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), ?)
    ON CONFLICT(booking_id, worker_id, date) DO UPDATE SET status = excluded.status, marked_at = excluded.marked_at,
      ot_hours = COALESCE(?, attendance.ot_hours), note = CASE WHEN ? = '' THEN attendance.note ELSE excluded.note END`)
    .run(b.id, workerId, date, status, nowIso(), otHours, note, otHours, note);
  if (status === 'absent') db.prepare('UPDATE attendance SET ot_hours = 0 WHERE booking_id = ? AND worker_id = ? AND date = ?').run(b.id, workerId, date);
  quality.recomputeTier(workerId);
}
r.markAttendance = markAttendance;

r.post('/contractor/bookings/:id/attendance', auth.requireRole('contractor'), (req, res) => {
  markAttendance(ownBooking(req), req.body);
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
  // Put the next best free worker on straight away, at the standard wage (no extra cost). Otherwise offer the job to everyone.
  const old = domain.getWorker(req.body.workerId);
  const replaced = await domain.autoReplace(b.id, old ? old.name : '');
  if (!replaced) {
    const c = domain.getContractor(req.user.id);
    if (domain.contractorPlanActive(c)) await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'replacement', params: { site: b.site } });
    await domain.broadcastJobOffer(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id));
  }
  res.json({ ok: true, replacedBy: replaced ? replaced.name : null });
});

r.post('/contractor/bookings/:id/cancel', auth.requireRole('contractor'), async (req, res) => {
  const b = ownBooking(req);
  if (b.status === 'cancelled') return res.json({ ok: true });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
  await domain.notifyCancelled([b.id]);
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
  const lat = req.query.lat ? Number(req.query.lat) : null, lng = req.query.lng ? Number(req.query.lng) : null;
  res.json({ counts: domain.availabilityCounts(start, days, level, req.user.id, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null) });
});

// ---------- worker ----------
r.get('/worker/jobs', auth.requireRole('worker'), (req, res) => {
  const w = domain.getWorker(req.user.id);
  if (!w) return res.json({ jobs: [] });
  const jobs = domain.eligibleJobs(w).map(b => ({
    id: b.id, skill_en: b.skill_en, skill_hi: b.skill_hi, skill_mr: b.skill_mr, site: b.site, start_date: b.start_date, days: b.days,
    site_address: b.site_address, site_lat: b.site_lat, site_lng: b.site_lng,
    pay_mode: b.pay_mode, company: b.company, wage: domain.workerDailyWage(w, b), needed: b.count - domain.activeCount(b.id),
    report_time: b.report_time, contractor_id: b.contractor_id, builder: quality.cFlags(domain.getContractor(b.contractor_id)),
    distanceKm: quality.distanceKm(w.home_lat, w.home_lng, b.site_lat, b.site_lng), travel_per_day: b.travel_per_day || 0,
    myAsk: db.prepare("SELECT id, wage, travel, note, status FROM counter_offers WHERE booking_id = ? AND worker_id = ? ORDER BY created_at DESC LIMIT 1").get(b.id, w.user_id) || null,
  }));
  res.json({ jobs });
});

r.post('/worker/jobs/:id/accept', auth.requireRole('worker'), async (req, res) => {
  const out = await domain.acceptJob(req.user.id, req.params.id, req.body && req.body.acceptTerms === true);
  res.json(Object.assign({ ok: true }, out));
});

r.get('/worker/work', auth.requireRole('worker'), (req, res) => {
  const w = domain.getWorker(req.user.id);
  if (!w) return res.json({ work: [] });
  const rows = db.prepare(`SELECT b.*, a.paid_confirmation, a.confirmed_at, a.wage_agreed, a.travel_agreed, a.terms_accepted_at AS a_terms, a.auto_assigned, c.company, u.phone AS contractor_phone FROM assignments a
    JOIN bookings b ON b.id = a.booking_id JOIN contractors c ON c.user_id = b.contractor_id JOIN users u ON u.id = b.contractor_id
    WHERE a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled' ORDER BY b.start_date DESC LIMIT 200`).all(w.user_id);
  res.json({ work: rows.map(b => ({
    id: b.id, skill_en: b.skill_en, skill_hi: b.skill_hi, skill_mr: b.skill_mr, site: b.site, start_date: b.start_date, days: b.days,
    site_address: b.site_address, site_lat: b.site_lat, site_lng: b.site_lng,
    pay_mode: b.pay_mode, company: b.company, contractor_phone: b.contractor_phone, wage: b.wage_agreed != null ? b.wage_agreed : domain.workerDailyWage(w, b), paid_confirmation: b.paid_confirmation,
    travel: b.travel_agreed != null ? b.travel_agreed : (b.travel_per_day || 0), agreed: b.wage_agreed != null || b.travel_agreed != null, terms_ok: Boolean(b.a_terms), auto_assigned: b.auto_assigned,
    pay: domain.attendancePay(b.id, w.user_id, domain.workerDailyWage(w, b)),
    today: (db.prepare('SELECT status FROM attendance WHERE booking_id = ? AND worker_id = ? AND date = ?').get(b.id, w.user_id, todayIST()) || {}).status || null,
    checkin: (db.prepare('SELECT at FROM checkins WHERE booking_id = ? AND worker_id = ? AND date = ?').get(b.id, w.user_id, todayIST()) || {}).at || null,
    onSiteToday: b.start_date <= todayIST() && domain.addDays(b.start_date, b.days - 1) >= todayIST(),
    end_date: domain.endDate(b), report_time: b.report_time, confirmed_at: b.confirmed_at, contractor_id: b.contractor_id,
    builder: quality.cFlags(domain.getContractor(b.contractor_id)),
    register: db.prepare('SELECT date, status, ot_hours, note FROM attendance WHERE booking_id = ? AND worker_id = ? ORDER BY date').all(b.id, w.user_id),
    rating: db.prepare('SELECT stars, comment, dispute, dispute_status FROM ratings WHERE booking_id = ? AND worker_id = ?').get(b.id, w.user_id) || null,
  })) });
});

// Worker: "I have reached the site". The builder gets a WhatsApp message and confirms attendance.
r.post('/worker/work/:id/checkin', auth.requireRole('worker'), async (req, res) => {
  const row = db.prepare(`SELECT b.* FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE a.booking_id = ? AND a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled'`).get(req.params.id, req.user.id);
  if (!row) throw new HttpError(404, 'Job not found.', 'not_found');
  const today = todayIST();
  if (row.start_date > today || domain.addDays(row.start_date, row.days - 1) < today) throw bad('You can check in only on working days of this job.', 'not_work_day');
  const done = db.prepare('SELECT 1 FROM checkins WHERE booking_id = ? AND worker_id = ? AND date = ?').get(row.id, req.user.id, today);
  if (done) return res.json({ ok: true });
  const at = nowIso();
  db.prepare('INSERT INTO checkins (booking_id, worker_id, date, at) VALUES (?, ?, ?, ?)').run(row.id, req.user.id, today, at);
  const w = domain.getWorker(req.user.id), c = domain.getContractor(row.contractor_id);
  const time = new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
  if (domain.contractorPlanActive(c)) await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'workerCheckin', params: { name: w.name, site: row.site, time } });
  res.json({ ok: true });
});

// Available / Busy until a date / Unavailable. (Older app versions send { available: true|false }.)
r.post('/worker/availability', auth.requireRole('worker'), (req, res) => {
  let status = req.body.status;
  if (!status && req.body.available !== undefined) status = req.body.available ? 'available' : 'unavailable';
  if (!['available', 'busy', 'unavailable'].includes(status)) throw bad('Choose Available, Busy or Unavailable.');
  let until = null;
  if (status === 'busy') {
    until = String(req.body.busyUntil || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < todayIST()) throw bad('Choose the date until which you are busy.', 'bad_date');
  }
  db.prepare('UPDATE workers SET avail_status = ?, busy_until = ?, available = ? WHERE user_id = ?').run(status, until, status === 'unavailable' ? 0 : 1, req.user.id);
  res.json({ ok: true });
});
r.post('/worker/work/:id/decline', auth.requireRole('worker'), async (req, res) => {
  const out = await domain.declineJob(req.user.id, req.params.id);
  res.json(Object.assign({ ok: true }, out));
});
// Ask the builder for a higher daily wage and/or travel money.
r.post('/worker/jobs/:id/ask', auth.requireRole('worker'), async (req, res) => {
  const row = await domain.askForMore(req.user.id, req.params.id, req.body || {});
  res.json({ ok: true, id: row.id });
});
r.post('/contractor/counters/:id/:decision', auth.requireRole('contractor'), async (req, res) => {
  if (!['accept', 'decline'].includes(req.params.decision)) throw new HttpError(404, 'Not found', 'not_found');
  res.json(Object.assign({ ok: true }, await domain.decideCounter(req.user.id, req.params.id, req.params.decision === 'accept')));
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
    require('../reports').createReport({ kind: 'payment', category: 'payment', urgent: false, bookingId: req.params.id, fromUser: req.user.id,
      againstUser: db.prepare('SELECT contractor_id FROM bookings WHERE id = ?').get(req.params.id).contractor_id, text: 'Worker says the direct payment for this job was not received.' });
    const admins = require('../config').adminPhones;
    for (const phone of admins) await wa.sendTemplate({ userId: null, phone, lang: 'en', templateKey: 'paymentIssue', params: { worker: w.name, site: row.site } });
  }
  res.json({ ok: true });
});

module.exports = r;
