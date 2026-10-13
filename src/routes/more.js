'use strict';
// Phase 2: calendar and travel radius, confirmations, ratings and disputes, builder dashboard, attendance register and
// wage finalising, worker search, favourites and teams, repeat booking, site notices, reports and blocks.
const { db, getSettings } = require('../db');
const { id, nowIso, todayIST, formatDate, rupees, HttpError, bad, str } = require('../util');
const auth = require('../auth');
const domain = require('../domain');
const quality = require('../quality');
const reports = require('../reports');
const wa = require('../services/whatsapp');

const r = require('../router')();
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const EXP_ORDER = ['0-1', '1-3', '3-5', '5+'];

function ownBooking(req) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND contractor_id = ?').get(req.params.id, req.user.id);
  if (!b) throw new HttpError(404, 'Booking not found.', 'not_found');
  return b;
}
function myAssignment(req) {
  const row = db.prepare(`SELECT a.*, b.* FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE a.booking_id = ? AND a.worker_id = ? AND a.status = 'active'`).get(req.params.id, req.user.id);
  if (!row) throw new HttpError(404, 'Job not found.', 'not_found');
  return row;
}

// ================= worker =================
r.get('/worker/calendar', auth.requireRole('worker'), (req, res) => {
  const from = todayIST(), to = todayIST(120);
  const off = db.prepare('SELECT date FROM worker_off_days WHERE worker_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(req.user.id, from, to).map(x => x.date);
  const jobs = db.prepare(`SELECT b.site, b.start_date, b.days FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled' AND date(b.start_date, '+' || (b.days - 1) || ' days') >= ?`).all(req.user.id, from)
    .map(b => ({ site: b.site, start: b.start_date, end: domain.endDate(b) }));
  res.json({ from, to, off, jobs });
});
r.post('/worker/calendar', auth.requireRole('worker'), (req, res) => {
  const dates = Array.isArray(req.body.dates) ? req.body.dates.map(String) : [String(req.body.date || '')];
  if (!dates.length || dates.length > 120 || dates.some(d => !isDate(d) || d < todayIST() || d > todayIST(120))) throw bad('Choose dates from today up to 4 months ahead.', 'bad_date');
  const off = Boolean(req.body.off);
  const ins = db.prepare('INSERT OR IGNORE INTO worker_off_days (worker_id, date) VALUES (?, ?)');
  const del = db.prepare('DELETE FROM worker_off_days WHERE worker_id = ? AND date = ?');
  db.transaction(() => dates.forEach(d => (off ? ins : del).run(req.user.id, d)))();
  res.json({ ok: true });
});
r.post('/worker/location', auth.requireRole('worker'), (req, res) => {
  const radius = Number(req.body.radiusKm);
  if (![0, 5, 10, 15, 25, 50].includes(radius)) throw bad('Choose how far you can travel.');
  let lat = req.body.lat, lng = req.body.lng;
  if (lat === null || lat === '' || lat === undefined) { lat = null; lng = null; } else {
    lat = Number(lat); lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad('Location not valid. Try again.');
  }
  if (lat === null && req.body.keepLocation) {
    db.prepare('UPDATE workers SET radius_km = ? WHERE user_id = ?').run(radius, req.user.id);
  } else {
    db.prepare('UPDATE workers SET home_lat = ?, home_lng = ?, radius_km = ? WHERE user_id = ?').run(lat, lng, radius, req.user.id);
  }
  res.json({ ok: true });
});
// "I will come" — answer to the reminder before the job.
r.post('/worker/work/:id/confirm', auth.requireRole('worker'), (req, res) => {
  const a = myAssignment(req);
  if (a.status === 'cancelled') throw bad('This booking is cancelled.');
  db.prepare('UPDATE assignments SET confirmed_at = COALESCE(confirmed_at, ?) WHERE booking_id = ? AND worker_id = ?').run(nowIso(), req.params.id, req.user.id);
  res.json({ ok: true });
});
r.get('/worker/ratings', auth.requireRole('worker'), (req, res) => {
  const rows = db.prepare(`SELECT r.*, b.site, b.skill_en, b.skill_hi, b.skill_mr, c.company FROM ratings r JOIN bookings b ON b.id = r.booking_id
    JOIN contractors c ON c.user_id = r.contractor_id WHERE r.worker_id = ? ORDER BY r.created_at DESC`).all(req.user.id);
  const w = domain.getWorker(req.user.id);
  res.json({ ratings: rows, summary: quality.ratingOf(req.user.id), reliability: quality.reliability(req.user.id), next: w ? quality.nextLevelSteps(w) : [] });
});
r.post('/worker/ratings/:id/dispute', auth.requireRole('worker'), async (req, res) => {
  const rt = db.prepare('SELECT * FROM ratings WHERE booking_id = ? AND worker_id = ?').get(req.params.id, req.user.id);
  if (!rt) throw new HttpError(404, 'Rating not found.', 'not_found');
  if (rt.dispute_status !== 'none') throw bad('You have already disputed this rating.', 'already_disputed');
  const text = str(req.body.text, { name: 'Reason', max: 500 });
  db.prepare("UPDATE ratings SET dispute = ?, dispute_status = 'open' WHERE booking_id = ? AND worker_id = ?").run(text, req.params.id, req.user.id);
  await reports.createReport({ kind: 'rating', category: 'rating', bookingId: req.params.id, fromUser: req.user.id, againstUser: rt.contractor_id, text: `Rating ${rt.stars}★ disputed: ${text}` });
  res.json({ ok: true });
});

// ================= builder =================
r.get('/contractor/dashboard', auth.requireRole('contractor'), (req, res) => {
  const today = todayIST(), week = todayIST(7);
  const all = db.prepare("SELECT * FROM bookings WHERE contractor_id = ? AND status IN ('pending_payment','open','assigned')").all(req.user.id);
  const live = all.filter(b => domain.endDate(b) >= today && b.status !== 'pending_payment');
  const confirmedQ = db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE booking_id = ? AND status = 'active'");
  let confirmed = 0, required = 0;
  for (const b of live) { const n = confirmedQ.get(b.id).n; confirmed += n; required += Math.max(0, b.count - n); }
  const todayLines = live.filter(b => b.start_date <= today);
  const sites = new Map();
  const tot = { expected: 0, present: 0, late: 0, absent: 0, checkedIn: 0, notCheckedIn: 0 };
  for (const b of todayLines) {
    const team = db.prepare(`SELECT a.worker_id, (SELECT status FROM attendance t WHERE t.booking_id = a.booking_id AND t.worker_id = a.worker_id AND t.date = ?) AS st,
        (SELECT 1 FROM checkins k WHERE k.booking_id = a.booking_id AND k.worker_id = a.worker_id AND k.date = ?) AS ci
      FROM assignments a WHERE a.booking_id = ? AND a.status = 'active'`).all(today, today, b.id);
    const key = b.group_id;
    const s = sites.get(key) || { groupId: key, bookingId: b.id, site: b.site, address: b.site_address, expected: 0, present: 0, late: 0, absent: 0, checkedIn: 0, notCheckedIn: 0, vacancies: 0 };
    s.vacancies += Math.max(0, b.count - team.length);
    for (const m of team) {
      s.expected++;
      if (m.st) s[m.st]++; else if (m.ci) s.checkedIn++; else s.notCheckedIn++;
    }
    sites.set(key, s);
  }
  for (const s of sites.values()) for (const k of Object.keys(tot)) tot[k] += s[k];
  // Money still to settle: unpaid bookings, and wages earned on direct-pay jobs that the worker has not confirmed as received.
  const unpaidBookings = all.filter(b => b.status === 'pending_payment').reduce((a, b) => a + b.amount_due, 0);
  let wagesOutstanding = 0, wagesToFinalise = 0;
  for (const b of db.prepare("SELECT * FROM bookings WHERE contractor_id = ? AND status != 'cancelled'").all(req.user.id)) {
    for (const a of db.prepare("SELECT a.worker_id, a.paid_confirmation, a.wages_final_at, w.custom_wage FROM assignments a JOIN workers w ON w.user_id = a.worker_id WHERE a.booking_id = ? AND a.status = 'active'").all(b.id)) {
      const pay = domain.attendancePay(b.id, a.worker_id, a.custom_wage != null ? a.custom_wage : b.wage);
      if (b.pay_mode === 'direct' && a.paid_confirmation !== 'yes') wagesOutstanding += pay.finalAmount != null ? pay.finalAmount : pay.earned;
      if (!a.wages_final_at && pay.payDays > 0) wagesToFinalise++;
    }
  }
  const upcoming = all.filter(b => b.start_date > today && b.start_date <= week).sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map(b => ({ id: b.id, site: b.site, skill_en: b.skill_en, skill_hi: b.skill_hi, skill_mr: b.skill_mr, count: b.count, start_date: b.start_date, assigned: confirmedQ.get(b.id).n, status: b.status }));
  const unconfirmed = db.prepare(`SELECT COUNT(*) AS n FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE b.contractor_id = ? AND a.status = 'active' AND b.status IN ('open','assigned') AND b.start_date IN (?, ?) AND a.confirmed_at IS NULL`).get(req.user.id, today, todayIST(1)).n;
  res.json({
    today, activeOrders: new Set(live.map(b => b.group_id)).size, activeLines: live.length, confirmed, required,
    attendance: tot, sites: [...sites.values()], unpaidBookings, wagesOutstanding, wagesToFinalise, upcoming, unconfirmed,
    openReports: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE from_user = ? AND status = 'open'").get(req.user.id).n,
  });
});

// Attendance register: every working day up to today × every worker, with overtime and wages.
r.get('/contractor/bookings/:id/register', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  const end = domain.endDate(b), last = end < todayIST() ? end : todayIST();
  const dates = [];
  for (let d = b.start_date; d <= last; d = domain.addDays(d, 1)) dates.push(d);
  const team = db.prepare(`SELECT a.worker_id, a.wages_final_at, a.paid_confirmation, w.name, w.custom_wage FROM assignments a JOIN workers w ON w.user_id = a.worker_id
    WHERE a.booking_id = ? AND a.status = 'active' ORDER BY a.assigned_at`).all(b.id).map(m => {
    const days = {};
    for (const x of db.prepare('SELECT date, status, ot_hours, note FROM attendance WHERE booking_id = ? AND worker_id = ?').all(b.id, m.worker_id)) days[x.date] = x;
    return { worker_id: m.worker_id, name: m.name, days, pay: domain.attendancePay(b.id, m.worker_id, m.custom_wage != null ? m.custom_wage : b.wage) };
  });
  res.json({ booking: { id: b.id, site: b.site, start_date: b.start_date, end_date: end, pay_mode: b.pay_mode, ot_rate: b.ot_rate, otRateEff: domain.otRate(b, b.wage) }, dates, team });
});
// Lock the wages for a worker after checking attendance. Changes after this go through a payment dispute.
r.post('/contractor/bookings/:id/finalise', auth.requireRole('contractor'), async (req, res) => {
  const b = ownBooking(req);
  const wid = String(req.body.workerId || '');
  const a = db.prepare("SELECT a.*, w.custom_wage, w.name FROM assignments a JOIN workers w ON w.user_id = a.worker_id WHERE a.booking_id = ? AND a.worker_id = ? AND a.status = 'active'").get(b.id, wid);
  if (!a) throw new HttpError(404, 'This worker is not on the booking.', 'not_found');
  if (a.wages_final_at) return res.json({ ok: true });
  const pay = domain.attendancePay(b.id, wid, a.custom_wage != null ? a.custom_wage : b.wage);
  if (!pay.payDays && !pay.absent) throw bad('Mark attendance before finalising wages.', 'no_attendance');
  db.prepare('UPDATE assignments SET wages_final_at = ?, wages_final_amount = ? WHERE booking_id = ? AND worker_id = ?').run(nowIso(), pay.earned, b.id, wid);
  const w = domain.getWorker(wid);
  await wa.sendTemplate({ userId: wid, phone: w.phone, lang: w.lang, templateKey: 'wagesFinal',
    params: { site: b.site, days: String(pay.payDays) + (pay.otHours ? ` + ${pay.otHours}h OT` : ''), amount: rupees(pay.earned) } });
  res.json({ ok: true, amount: pay.earned });
});
// Rate a worker once the job's last day has come. One rating per worker per booking line; the worker can dispute it.
r.post('/contractor/bookings/:id/rate', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  if (domain.endDate(b) > todayIST()) throw bad('You can rate workers from the last day of the job.', 'not_finished');
  const wid = String(req.body.workerId || '');
  if (!db.prepare("SELECT 1 FROM assignments WHERE booking_id = ? AND worker_id = ? AND status = 'active'").get(b.id, wid)) throw new HttpError(404, 'This worker is not on the booking.', 'not_found');
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Choose 1 to 5 stars.');
  const comment = str(req.body.comment, { name: 'Comment', max: 300, required: false });
  const old = db.prepare('SELECT dispute_status FROM ratings WHERE booking_id = ? AND worker_id = ?').get(b.id, wid);
  if (old && old.dispute_status !== 'none') throw bad('This rating is under review and cannot be changed.', 'disputed');
  db.prepare(`INSERT INTO ratings (booking_id, worker_id, contractor_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(booking_id, worker_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment`).run(b.id, wid, req.user.id, stars, comment, nowIso());
  quality.recomputeTier(wid);
  res.json({ ok: true });
});
// Reporting time and agreed overtime rate for the whole order.
r.patch('/contractor/bookings/:id/terms', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  if (req.body.reportTime !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.body.reportTime))) throw bad('Choose a reporting time.');
    db.prepare('UPDATE bookings SET report_time = ? WHERE group_id = ?').run(String(req.body.reportTime), b.group_id);
  }
  if (req.body.otRate !== undefined) {
    const v = req.body.otRate === null || req.body.otRate === '' ? null : Number(req.body.otRate);
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 10000)) throw bad('Overtime rate must be between ₹0 and ₹10,000 per hour.');
    db.prepare('UPDATE bookings SET ot_rate = ? WHERE group_id = ?').run(v, b.group_id);
  }
  res.json({ ok: true });
});
// Urgent message to every worker on the site (all lines of the order): closure, change of time, safety notice.
async function sendNotice(groupId, text, sentBy) {
  const t = String(text || '').trim();
  if (t.length < 3 || t.length > 300) throw bad('Write a message of 3 to 300 characters.');
  const n = db.prepare("SELECT COUNT(*) AS n FROM site_notices WHERE group_id = ? AND created_at >= ?").get(groupId, new Date(Date.now() - 86400000).toISOString()).n;
  if (n >= 5) throw new HttpError(429, 'At most 5 urgent messages per site per day.', 'notice_limit');
  const first = domain.groupLines(groupId)[0];
  const c = domain.getContractor(first.contractor_id);
  db.prepare('INSERT INTO site_notices (group_id, text, sent_by, created_at) VALUES (?, ?, ?, ?)').run(groupId, t, sentBy, nowIso());
  const ws = db.prepare(`SELECT DISTINCT w.user_id, u.phone, u.lang FROM assignments a JOIN bookings b ON b.id = a.booking_id JOIN workers w ON w.user_id = a.worker_id JOIN users u ON u.id = a.worker_id
    WHERE b.group_id = ? AND a.status = 'active' AND b.status != 'cancelled' AND u.deleted_at IS NULL`).all(groupId);
  for (const w of ws) await wa.sendTemplate({ userId: w.user_id, phone: w.phone, lang: w.lang, templateKey: 'siteNotice', params: { company: c.company, site: first.site, text: t } });
  return ws.length;
}
r.sendNotice = sendNotice;
r.post('/contractor/bookings/:id/notice', auth.requireRole('contractor'), async (req, res) => {
  const b = ownBooking(req);
  res.json({ ok: true, sentTo: await sendNotice(b.group_id, req.body.text, req.user.id) });
});
r.get('/contractor/bookings/:id/notices', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  res.json({ notices: db.prepare('SELECT text, created_at FROM site_notices WHERE group_id = ? ORDER BY id DESC LIMIT 20').all(b.group_id) });
});

// Find workers: filters and smart ranking. Shows no phone numbers.
r.get('/contractor/workers', auth.requireRole('contractor'), (req, res) => {
  const q = req.query;
  const skill = q.skill ? String(q.skill) : '';
  let rows = db.prepare(`SELECT DISTINCT w.*, u.phone, u.lang FROM workers w JOIN users u ON u.id = w.user_id
    ${skill ? 'JOIN worker_skills ws ON ws.worker_id = w.user_id AND ws.skill_id = @skill' : ''}
    WHERE u.deleted_at IS NULL AND w.membership_status != 'deleted'`).all(skill ? { skill } : {});
  rows = rows.filter(w => domain.workerHasAccess(w) && !quality.blocked(w.user_id, req.user.id));
  const sk = skill ? db.prepare('SELECT * FROM skills WHERE id = ?').get(skill) : null;
  const site = q.lat && q.lng ? { site_lat: Number(q.lat), site_lng: Number(q.lng) } : null;
  const start = isDate(q.start) ? String(q.start) : null, days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 1));
  const area = String(q.area || '').trim().toLowerCase();
  const minExp = EXP_ORDER.indexOf(String(q.exp || ''));
  const minRating = Number(q.minRating) || 0, maxWage = Number(q.maxWage) || 0;
  const level = ['silver', 'gold'].includes(q.level) ? q.level : 'any';
  const skillsOf = db.prepare('SELECT s.id, s.en, s.hi, s.mr, s.wage FROM worker_skills ws JOIN skills s ON s.id = ws.skill_id WHERE ws.worker_id = ? AND s.active = 1');
  const out = [];
  for (const w of rows) {
    if (area && !String(w.area || '').toLowerCase().includes(area)) continue;
    if (minExp > 0 && EXP_ORDER.indexOf(w.experience) < minExp) continue;
    if (level === 'gold' && w.tier !== 'gold') continue;
    if (level === 'silver' && w.tier === 'bronze') continue;
    if (q.verified === '1' && !w.verified_aadhaar) continue;
    const skills = skillsOf.all(w.user_id);
    const wage = w.custom_wage != null ? w.custom_wage : sk ? sk.wage : Math.min(...skills.map(s => s.wage), Infinity);
    if (maxWage && wage > maxWage) continue;
    if (start) {
      const probe = { start_date: start, days, level: 'any', id: '', contractor_id: req.user.id, site_lat: site ? site.site_lat : null, site_lng: site ? site.site_lng : null };
      if (!domain.workerFits(w, probe)) continue;
    }
    const card = domain.workerCard(w, site, req.user.id, null);
    if (minRating && !(card.rating.avg >= minRating)) continue;
    if (q.fav === '1' && !card.favourite) continue;
    out.push(Object.assign(card, { wage: Number.isFinite(wage) ? wage : null, skills: skills.map(s => s.id) }));
  }
  out.sort((a, b) => b.score - a.score);
  res.json({ workers: out.slice(0, 200), total: out.length });
});
r.post('/contractor/favourites', auth.requireRole('contractor'), (req, res) => {
  const wid = String(req.body.workerId || '');
  if (!domain.getWorker(wid)) throw new HttpError(404, 'Worker not found.', 'not_found');
  if (req.body.on === false) db.prepare('DELETE FROM favourites WHERE contractor_id = ? AND worker_id = ?').run(req.user.id, wid);
  else db.prepare('INSERT OR IGNORE INTO favourites (contractor_id, worker_id, created_at) VALUES (?, ?, ?)').run(req.user.id, wid, nowIso());
  res.json({ ok: true });
});
r.get('/contractor/teams', auth.requireRole('contractor'), (req, res) => {
  const teams = db.prepare('SELECT * FROM teams WHERE contractor_id = ? ORDER BY created_at DESC').all(req.user.id).map(t => Object.assign(t, {
    members: db.prepare(`SELECT m.worker_id, m.skill_id, w.name, s.en AS skill_en, s.hi AS skill_hi, s.mr AS skill_mr FROM team_members m
      JOIN workers w ON w.user_id = m.worker_id JOIN users u ON u.id = m.worker_id LEFT JOIN skills s ON s.id = m.skill_id WHERE m.team_id = ? AND u.deleted_at IS NULL`).all(t.id),
  }));
  res.json({ teams });
});
// Save a team from an order's assigned workers.
r.post('/contractor/teams', auth.requireRole('contractor'), (req, res) => {
  const name = str(req.body.name, { name: 'Team name', max: 60 });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND contractor_id = ?').get(String(req.body.bookingId || ''), req.user.id);
  if (!b) throw new HttpError(404, 'Booking not found.', 'not_found');
  const members = db.prepare(`SELECT a.worker_id, x.skill_id FROM assignments a JOIN bookings x ON x.id = a.booking_id
    WHERE x.group_id = ? AND a.status = 'active'`).all(b.group_id);
  if (!members.length) throw bad('No workers on this booking yet.');
  const tid = id('tm');
  db.transaction(() => {
    db.prepare('INSERT INTO teams (id, contractor_id, name, created_at) VALUES (?, ?, ?, ?)').run(tid, req.user.id, name, nowIso());
    const ins = db.prepare('INSERT OR IGNORE INTO team_members (team_id, worker_id, skill_id) VALUES (?, ?, ?)');
    members.forEach(m => ins.run(tid, m.worker_id, m.skill_id));
  })();
  res.json({ ok: true, id: tid, size: members.length });
});
r.delete('/contractor/teams/:id', auth.requireRole('contractor'), (req, res) => {
  const t = db.prepare('SELECT 1 FROM teams WHERE id = ? AND contractor_id = ?').get(req.params.id, req.user.id);
  if (!t) throw new HttpError(404, 'Team not found.', 'not_found');
  db.transaction(() => { db.prepare('DELETE FROM team_members WHERE team_id = ?').run(req.params.id); db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id); })();
  res.json({ ok: true });
});
// "Book again": everything needed to fill the booking form from a past order, with its workers preferred.
r.get('/contractor/bookings/:id/repeat', auth.requireRole('contractor'), (req, res) => {
  const b = ownBooking(req);
  const lines = domain.groupLines(b.group_id).filter(x => x.status !== 'pending_payment' || x.id === b.id);
  const workers = db.prepare(`SELECT DISTINCT a.worker_id FROM assignments a JOIN bookings x ON x.id = a.booking_id WHERE x.group_id = ? AND a.status = 'active'`).all(b.group_id).map(x => x.worker_id);
  res.json({ lines: lines.map(l => ({ skillId: l.skill_id, count: l.count })), site: b.site, siteAddress: b.site_address, siteLat: b.site_lat, siteLng: b.site_lng,
    days: b.days, level: b.level, qc: Boolean(lines.some(l => l.qc)), payMode: b.pay_mode, reportTime: b.report_time, otRate: b.ot_rate, preferWorkers: workers });
});

// ================= both sides: reports and blocks =================
r.post('/reports', auth.requireUser, async (req, res) => {
  const bookingId = req.body.bookingId ? String(req.body.bookingId) : null;
  let against = req.body.againstUser ? String(req.body.againstUser) : null;
  if (bookingId) {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    const mine = b && (b.contractor_id === req.user.id || db.prepare('SELECT 1 FROM assignments WHERE booking_id = ? AND worker_id = ?').get(bookingId, req.user.id));
    if (!mine) throw new HttpError(404, 'Booking not found.', 'not_found');
    if (!against && req.user.role === 'worker') against = b.contractor_id;
  }
  const kind = ['payment', 'problem', 'incident'].includes(req.body.kind) ? req.body.kind : 'problem';
  const row = await reports.createReport({ kind, category: String(req.body.category || 'other'), urgent: req.body.urgent, bookingId, fromUser: req.user.id, againstUser: against, text: req.body.text });
  res.json({ ok: true, id: row.id, urgent: Boolean(row.urgent) });
});
r.get('/reports/mine', auth.requireUser, (req, res) => {
  res.json({ reports: reports.listReports('WHERE r.from_user = ?', req.user.id).map(x => ({ id: x.id, kind: x.kind, category: x.category, urgent: x.urgent, site: x.site, text: x.text, status: x.status, resolution: x.resolution, created_at: x.created_at, against_name: x.against_name })) });
});
r.get('/blocks', auth.requireUser, (req, res) => {
  res.json({ blocks: db.prepare('SELECT blocked_id, created_at FROM blocks WHERE blocker_id = ? ORDER BY created_at DESC').all(req.user.id).map(x => Object.assign(x, { name: reports.nameOf(x.blocked_id) })) });
});
r.post('/blocks', auth.requireUser, (req, res) => {
  const other = db.prepare('SELECT id, role FROM users WHERE id = ?').get(String(req.body.userId || ''));
  if (!other || other.id === req.user.id || other.role === req.user.role) throw new HttpError(404, 'Account not found.', 'not_found');
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(req.user.id, other.id, nowIso());
  if (req.user.role === 'contractor') db.prepare('DELETE FROM favourites WHERE contractor_id = ? AND worker_id = ?').run(req.user.id, other.id);
  res.json({ ok: true });
});
r.delete('/blocks/:id', auth.requireUser, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

module.exports = r;
