'use strict';
// Business rules shared by routes and webhooks: pricing, matching, payments fulfilment, memberships.
const { db, getSettings } = require('./db');
const { id, nowIso, todayIST, formatDate, rupees, HttpError, bad } = require('./util');
const wa = require('./services/whatsapp');

const LEVELS = ['any', 'silver', 'gold'];

function quote(settings, skill, { count, days, level, qc, payMode }, planActive) {
  const bonus = level === 'gold' ? settings.gold_bonus : level === 'silver' ? settings.silver_bonus : 0;
  const wage = skill.wage + bonus;
  const price = wage + settings.margin_per_worker_day;
  const qcCost = qc ? settings.qc_per_day * days : 0;
  const jobFee = planActive ? 0 : settings.job_fee;
  const total = price * count * days + qcCost + jobFee;
  const feeNow = jobFee + qcCost;
  const wagesYou = wage * count * days;
  return { wage, price, qcCost, jobFee, total, feeNow, wagesYou, amountDue: payMode === 'lk' ? total : feeNow };
}

// Paid (or admin-granted trial) accounts only. Unpaid accounts get no offers and no notifications.
const contractorPlanActive = (c) => Boolean(c && (c.plan_status === 'active' || (c.plan_status === 'trial' && c.trial_until && c.trial_until >= todayIST())));
const workerHasAccess = (w) => Boolean(w && (w.membership_status === 'active' || (w.membership_status === 'trial' && w.trial_until && w.trial_until >= todayIST())));
const contractorPlanPrice = (c, s) => (c && c.custom_price != null ? c.custom_price : s.contractor_plan);
const workerMonthlyPrice = (w, s) => (w && w.custom_price != null ? w.custom_price : s.worker_monthly);
const workerCashPrice = (w, s) => (w && w.custom_price != null ? w.custom_price : s.worker_cash_monthly);
const getContractor = (uid) => db.prepare('SELECT c.*, u.phone, u.lang FROM contractors c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?').get(uid);
const getWorker = (uid) => db.prepare('SELECT w.*, u.phone, u.lang FROM workers w JOIN users u ON u.id = w.user_id WHERE w.user_id = ?').get(uid);
const workerSkillIds = (uid) => db.prepare('SELECT skill_id FROM worker_skills WHERE worker_id = ?').all(uid).map(r => r.skill_id);
const activeCount = (bookingId) => db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE booking_id = ? AND status = 'active'").get(bookingId).n;
const skillLabel = (b, lang) => (lang === 'hi' ? b.skill_hi : lang === 'mr' ? b.skill_mr : b.skill_en) || b.skill_en;

function workerDailyWage(worker, booking) {
  return worker.custom_wage != null ? worker.custom_wage : booking.wage;
}

function tierAllowed(tier, level) {
  if (level === 'gold') return tier === 'gold';
  if (level === 'silver') return tier === 'gold' || tier === 'silver';
  return true;
}

// Is the worker already on another active job whose dates overlap [start, start + days - 1]?
function workerBusy(workerId, start, days, exceptBookingId) {
  const end = addDays(start, days - 1);
  return Boolean(db.prepare(`SELECT 1 FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled' AND b.id != ?
      AND b.start_date <= ? AND date(b.start_date, '+' || (b.days - 1) || ' days') >= ? LIMIT 1`).get(workerId, exceptBookingId || '', end, start));
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Can this worker take this booking line right now?
function workerFits(w, b) {
  return workerHasAccess(w) && w.available !== 0 && tierAllowed(w.tier, b.level) && !workerBusy(w.user_id, b.start_date, b.days, b.id);
}

/** Workers a contractor can pick for a booking line: right skill and level, paid or on trial, available and free on those dates. */
function availableWorkers(b) {
  const rows = db.prepare(`SELECT w.*, u.phone, u.lang FROM workers w JOIN users u ON u.id = w.user_id
    JOIN worker_skills ws ON ws.worker_id = w.user_id WHERE ws.skill_id = ?
      AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.booking_id = ? AND a.worker_id = w.user_id)`).all(b.skill_id, b.id || '');
  const done = db.prepare(`SELECT COUNT(*) AS n FROM assignments a JOIN bookings x ON x.id = a.booking_id
    WHERE a.worker_id = ? AND a.status = 'active' AND x.status != 'cancelled' AND date(x.start_date, '+' || (x.days - 1) || ' days') < ?`);
  const tierRank = { gold: 0, silver: 1, bronze: 2 };
  return rows.filter(w => workerFits(w, b)).map(w => ({
    worker_id: w.user_id, name: w.name, area: w.area, experience: w.experience, tier: w.tier,
    verified: w.verified_aadhaar + w.verified_photo + w.verified_bank + w.verified_test,
    jobs_done: done.get(w.user_id, todayIST()).n, wage: workerDailyWage(w, b),
  })).sort((x, y) => tierRank[x.tier] - tierRank[y.tier] || y.verified - x.verified || y.jobs_done - x.jobs_done);
}

/** How many workers are free per skill for given dates and level (for the booking form). */
function availabilityCounts(start, days, level) {
  const out = {};
  const probe = { start_date: start, days, level, id: '' };
  const rows = db.prepare(`SELECT w.*, ws.skill_id FROM workers w JOIN worker_skills ws ON ws.worker_id = w.user_id`).all();
  for (const w of rows) if (workerFits(w, probe)) out[w.skill_id] = (out[w.skill_id] || 0) + 1;
  return out;
}

function eligibleJobs(worker) {
  if (!workerHasAccess(worker) || worker.available === 0) return [];
  const skills = workerSkillIds(worker.user_id);
  if (!skills.length) return [];
  const rows = db.prepare(`SELECT b.*, c.company FROM bookings b JOIN contractors c ON c.user_id = b.contractor_id
    WHERE b.status = 'open' AND b.start_date >= ? AND b.skill_id IN (${skills.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.booking_id = b.id AND a.worker_id = ?)
    ORDER BY b.start_date ASC, b.created_at ASC LIMIT 100`).all(todayIST(), ...skills, worker.user_id);
  return rows.filter(b => tierAllowed(worker.tier, b.level) && activeCount(b.id) < b.count && !workerBusy(worker.user_id, b.start_date, b.days, b.id));
}

async function broadcastJobOffer(booking) {
  const rows = db.prepare(`SELECT w.*, u.phone, u.lang FROM workers w JOIN users u ON u.id = w.user_id
    JOIN worker_skills ws ON ws.worker_id = w.user_id WHERE ws.skill_id = ?`).all(booking.skill_id);
  const targets = rows.filter(w => workerFits(w, booking)).slice(0, 50);
  for (const w of targets) {
    await wa.sendTemplate({ userId: w.user_id, phone: w.phone, lang: w.lang, templateKey: 'jobOffer',
      params: { skill: skillLabel(booking, w.lang), site: booking.site, date: formatDate(booking.start_date), wage: rupees(workerDailyWage(w, booking)) } });
  }
}

// Short summary of an order's lines, e.g. "4 × Mason + 6 × Helper".
function linesSummary(lines, lang) { return lines.map(b => `${b.count} × ${skillLabel(b, lang)}`).join(' + '); }
const groupLines = (groupId) => db.prepare("SELECT * FROM bookings WHERE group_id = ? ORDER BY created_at, rowid").all(groupId);

/** Make a paid (or no-payment) order visible to workers and notify everyone once. */
async function openGroup(groupId) {
  const lines = groupLines(groupId).filter(b => b.status === 'pending_payment' || b.status === 'open');
  if (!lines.length) return;
  db.prepare("UPDATE bookings SET status = 'open' WHERE group_id = ? AND status = 'pending_payment'").run(groupId);
  const first = lines[0];
  const c = getContractor(first.contractor_id);
  if (contractorPlanActive(c)) await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'bookingReceived',
    params: { count: lines.reduce((a, b) => a + b.count, 0), skill: linesSummary(lines, c.lang), site: first.site, date: formatDate(first.start_date) } });
  for (const b of lines) await broadcastJobOffer(b);
}
const openBooking = (bookingId) => {
  const b = db.prepare('SELECT group_id FROM bookings WHERE id = ?').get(bookingId);
  return b ? openGroup(b.group_id) : undefined;
};

/** Mark a payment as paid and grant whatever it was for. Safe to call more than once. */
async function fulfilPayment(paymentId, rzpPaymentId) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!p) return;
  const first = db.prepare("UPDATE payments SET status = 'paid', rzp_payment_id = COALESCE(?, rzp_payment_id), updated_at = ? WHERE id = ? AND status != 'paid'")
    .run(rzpPaymentId || null, nowIso(), p.id).changes > 0;
  if (!first) return;
  if (p.kind === 'booking') {
    db.prepare("UPDATE bookings SET payment_status = 'paid' WHERE group_id = ? AND payment_status = 'pending'").run(p.ref_id);
    await openGroup(p.ref_id);
  } else if (p.kind === 'worker_membership') {
    await activateWorkerMembership(p.ref_id, 'upi', p.rzp_subscription_id);
  } else if (p.kind === 'contractor_plan') {
    await activateContractorPlan(p.ref_id, p.rzp_subscription_id);
  }
}

async function activateWorkerMembership(workerId, method, subscriptionId) {
  const w = getWorker(workerId);
  if (!w || w.membership_status === 'active') return;
  db.prepare("UPDATE workers SET membership_status = 'active', membership_method = ?, membership_since = ?, rzp_subscription_id = COALESCE(?, rzp_subscription_id) WHERE user_id = ?")
    .run(method, todayIST(), subscriptionId || null, workerId);
  await wa.sendTemplate({ userId: w.user_id, phone: w.phone, lang: w.lang, templateKey: 'membershipStarted', params: { method: method === 'cash' ? 'Cash' : 'UPI AutoPay' } });
}

async function activateContractorPlan(contractorId, subscriptionId) {
  const c = getContractor(contractorId);
  if (!c || c.plan_status === 'active') return;
  const amount = contractorPlanPrice(c, getSettings());
  db.prepare("UPDATE contractors SET plan_status = 'active', plan_since = ?, rzp_subscription_id = COALESCE(?, rzp_subscription_id) WHERE user_id = ?")
    .run(todayIST(), subscriptionId || null, contractorId);
  await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'planStarted', params: { amount: rupees(amount) } });
}

function deactivateBySubscription(subscriptionId) {
  db.prepare("UPDATE workers SET membership_status = 'none' WHERE rzp_subscription_id = ?").run(subscriptionId);
  db.prepare("UPDATE contractors SET plan_status = 'none' WHERE rzp_subscription_id = ?").run(subscriptionId);
}

/** Put a worker on a booking line. One transaction, so a booking can never be over-filled. */
async function assignWorker(worker, bookingId) {
  const result = db.transaction(() => {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!b || b.status !== 'open') throw new HttpError(409, 'This job was just filled.', 'filled');
    const n = activeCount(bookingId);
    if (n >= b.count) throw new HttpError(409, 'This job was just filled.', 'filled');
    db.prepare(`INSERT INTO assignments (booking_id, worker_id, status, assigned_at) VALUES (?, ?, 'active', ?)
      ON CONFLICT(booking_id, worker_id) DO UPDATE SET status = 'active', assigned_at = excluded.assigned_at, paid_confirmation = NULL`).run(bookingId, worker.user_id, nowIso());
    const full = n + 1 >= b.count;
    if (full) db.prepare("UPDATE bookings SET status = 'assigned' WHERE id = ?").run(bookingId);
    return { booking: b, full };
  })();
  const b = result.booking;
  const c = getContractor(b.contractor_id);
  await wa.sendTemplate({ userId: worker.user_id, phone: worker.phone, lang: worker.lang, templateKey: 'jobConfirmed',
    params: { skill: skillLabel(b, worker.lang), site: b.site, date: formatDate(b.start_date), company: c.company, phone: c.phone } });
  // "Team ready" once every line of the order is filled.
  const lines = groupLines(b.group_id).filter(x => x.status !== 'cancelled');
  if (result.full && lines.every(x => x.status === 'assigned') && contractorPlanActive(c)) {
    await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'teamReady',
      params: { count: lines.reduce((a, x) => a + x.count, 0), skill: linesSummary(lines, c.lang), site: b.site, date: formatDate(b.start_date) } });
  }
  return { full: result.full };
}

/** Worker accepts an offered job. */
async function acceptJob(workerId, bookingId) {
  const worker = getWorker(workerId);
  if (!worker) throw new HttpError(403, 'Create your worker profile first.', 'no_profile');
  if (!eligibleJobs(worker).some(b => b.id === bookingId)) throw new HttpError(409, 'This job is no longer available to you.', 'not_available');
  return assignWorker(worker, bookingId);
}

/** Contractor picks a specific available worker for their booking line. */
async function selectWorker(contractorId, bookingId, workerId) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ? AND contractor_id = ?').get(bookingId, contractorId);
  if (!b) throw new HttpError(404, 'Booking not found.', 'not_found');
  if (!contractorPlanActive(getContractor(contractorId))) throw new HttpError(402, 'Activate your contractor plan to choose workers.', 'plan_required');
  if (b.status !== 'open') throw new HttpError(409, b.status === 'pending_payment' ? 'Complete the payment first.' : 'This booking is already full.', 'not_open');
  if (!availableWorkers(b).some(w => w.worker_id === workerId)) throw new HttpError(409, 'This worker is no longer available.', 'not_available');
  return assignWorker(getWorker(workerId), bookingId);
}

/** Worker can't go after all: frees the place and offers it to others. */
async function declineJob(workerId, bookingId) {
  const a = db.prepare("SELECT a.*, b.site, b.contractor_id FROM assignments a JOIN bookings b ON b.id = a.booking_id WHERE a.booking_id = ? AND a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled'").get(bookingId, workerId);
  if (!a) throw new HttpError(404, 'Job not found.', 'not_found');
  db.transaction(() => {
    db.prepare("UPDATE assignments SET status = 'declined' WHERE booking_id = ? AND worker_id = ?").run(bookingId, workerId);
    db.prepare("UPDATE bookings SET status = 'open' WHERE id = ? AND status = 'assigned'").run(bookingId);
  })();
  const c = getContractor(a.contractor_id);
  if (contractorPlanActive(c)) await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'replacement', params: { site: a.site } });
  await broadcastJobOffer(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId));
}

function validateBookingInput(body) {
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw bad('Number of days must be between 1 and 90.');
  // Lines: [{ skillId, count }]. A single { skillId, count } is accepted too.
  const raw = Array.isArray(body.lines) ? body.lines : [{ skillId: body.skillId, count: body.count }];
  const merged = new Map();
  for (const l of raw) {
    const count = Number(l && l.count);
    const skillId = String((l && l.skillId) || '');
    if (!skillId || count === 0) continue;
    if (!Number.isInteger(count) || count < 1 || count > 100) throw bad('Number of workers must be between 1 and 100.');
    merged.set(skillId, (merged.get(skillId) || 0) + count);
  }
  const lines = [...merged].map(([skillId, count]) => ({ skillId, count }));
  if (!lines.length) throw bad('Add at least one skilled or unskilled worker.');
  if (lines.length > 15) throw bad('Too many types of work in one booking.');
  if (lines.reduce((a, l) => a + l.count, 0) > 200) throw bad('At most 200 workers in one booking.');
  const level = LEVELS.includes(body.level) ? body.level : 'any';
  const payMode = body.payMode === 'direct' ? 'direct' : 'lk';
  const site = String(body.site || '').trim();
  if (!site) throw bad('Enter the site name.');
  if (site.length > 160) throw bad('Site name is too long.');
  const siteAddress = String(body.siteAddress || '').trim();
  if (siteAddress.length > 300) throw bad('Site address is too long.');
  let lat = body.siteLat == null || body.siteLat === '' ? null : Number(body.siteLat);
  let lng = body.siteLng == null || body.siteLng === '' ? null : Number(body.siteLng);
  if (lat !== null || lng !== null) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { lat = null; lng = null; }
  }
  const start = String(body.startDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < todayIST()) throw bad('Choose a start date from today onwards.');
  return { lines, days, level, qc: Boolean(body.qc), payMode, site, siteAddress, lat, lng, start };
}

/** Create an order: one booking row per type of work, sharing group_id. Job fee and Quality In-charge are charged once. */
function createBooking(contractorId, body) {
  const input = validateBookingInput(body);
  const c = getContractor(contractorId);
  if (!c) throw new HttpError(403, 'Create your company profile first.', 'no_profile');
  if (!contractorPlanActive(c)) throw new HttpError(402, 'Activate your contractor plan to book workers.', 'plan_required');
  const settings = getSettings();
  const planActive = contractorPlanActive(c);
  const skills = input.lines.map(l => {
    const sk = db.prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(l.skillId);
    if (!sk) throw bad('Choose a type of work.');
    return sk;
  });
  const groupId = id('ord');
  const now = nowIso();
  const rows = input.lines.map((l, i) => {
    const q = quote(settings, skills[i], { count: l.count, days: input.days, level: input.level, qc: i === 0 && input.qc, payMode: input.payMode }, planActive || i > 0);
    return { l, sk: skills[i], q };
  });
  const amountDue = rows.reduce((a, r) => a + r.q.amountDue, 0);
  const needsPayment = amountDue > 0;
  const ins = db.prepare(`INSERT INTO bookings (id, group_id, contractor_id, skill_id, skill_en, skill_hi, skill_mr, count, days, level, qc, pay_mode, site, site_address, site_lat, site_lng, start_date,
      wage, price, job_fee, qc_cost, total, fee_now, wages_you, amount_due, payment_status, status, created_at)
    VALUES (@id, @group_id, @contractor_id, @skill_id, @skill_en, @skill_hi, @skill_mr, @count, @days, @level, @qc, @pay_mode, @site, @site_address, @site_lat, @site_lng, @start_date,
      @wage, @price, @job_fee, @qc_cost, @total, @fee_now, @wages_you, @amount_due, @payment_status, @status, @created_at)`);
  const bookingIds = [];
  db.transaction(() => rows.forEach(({ l, sk, q }, i) => {
    const bid = id('bk'); bookingIds.push(bid);
    ins.run({
      id: bid, group_id: groupId, contractor_id: contractorId, skill_id: sk.id, skill_en: sk.en, skill_hi: sk.hi, skill_mr: sk.mr,
      count: l.count, days: input.days, level: input.level, qc: i === 0 && input.qc ? 1 : 0, pay_mode: input.payMode,
      site: input.site, site_address: input.siteAddress, site_lat: input.lat, site_lng: input.lng, start_date: input.start,
      wage: q.wage, price: q.price, job_fee: q.jobFee, qc_cost: q.qcCost, total: q.total, fee_now: q.feeNow, wages_you: q.wagesYou, amount_due: q.amountDue,
      payment_status: needsPayment ? 'pending' : 'not_required', status: needsPayment ? 'pending_payment' : 'open', created_at: now,
    });
  }))();
  return { groupId, bookingId: bookingIds[0], bookingIds, amountDue, needsPayment };
}

module.exports = {
  quote, getContractor, getWorker, workerSkillIds, eligibleJobs, acceptJob, selectWorker, declineJob, availableWorkers, availabilityCounts, addDays, createBooking, openBooking, openGroup,
  fulfilPayment, activateWorkerMembership, activateContractorPlan, deactivateBySubscription,
  contractorPlanActive, workerHasAccess, contractorPlanPrice, workerMonthlyPrice, workerCashPrice, workerDailyWage, skillLabel, activeCount, broadcastJobOffer,
};
