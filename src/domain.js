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

const contractorPlanActive = (c) => c && c.plan_status === 'active';
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

function eligibleJobs(worker) {
  const settings = getSettings();
  if (settings.worker_membership_required && worker.membership_status !== 'active') return [];
  const skills = workerSkillIds(worker.user_id);
  if (!skills.length) return [];
  const rows = db.prepare(`SELECT b.*, c.company FROM bookings b JOIN contractors c ON c.user_id = b.contractor_id
    WHERE b.status = 'open' AND b.start_date >= ? AND b.skill_id IN (${skills.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.booking_id = b.id AND a.worker_id = ?)
    ORDER BY b.start_date ASC, b.created_at ASC LIMIT 100`).all(todayIST(), ...skills, worker.user_id);
  return rows.filter(b => tierAllowed(worker.tier, b.level) && activeCount(b.id) < b.count);
}

async function broadcastJobOffer(booking) {
  const settings = getSettings();
  const rows = db.prepare(`SELECT w.*, u.phone, u.lang FROM workers w JOIN users u ON u.id = w.user_id
    JOIN worker_skills ws ON ws.worker_id = w.user_id WHERE ws.skill_id = ?`).all(booking.skill_id);
  const targets = rows.filter(w => tierAllowed(w.tier, booking.level) && (!settings.worker_membership_required || w.membership_status === 'active')).slice(0, 50);
  for (const w of targets) {
    await wa.sendTemplate({ userId: w.user_id, phone: w.phone, lang: w.lang, templateKey: 'jobOffer',
      params: { skill: skillLabel(booking, w.lang), site: booking.site, date: formatDate(booking.start_date), wage: rupees(workerDailyWage(w, booking)) } });
  }
}

async function openBooking(bookingId) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b || b.status !== 'pending_payment' && b.status !== 'open') return;
  db.prepare("UPDATE bookings SET status = 'open' WHERE id = ? AND status = 'pending_payment'").run(bookingId);
  const c = getContractor(b.contractor_id);
  await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'bookingReceived',
    params: { count: b.count, skill: skillLabel(b, c.lang), site: b.site, date: formatDate(b.start_date) } });
  await broadcastJobOffer(b);
}

/** Mark a payment as paid and grant whatever it was for. Safe to call more than once. */
async function fulfilPayment(paymentId, rzpPaymentId) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!p) return;
  const first = db.prepare("UPDATE payments SET status = 'paid', rzp_payment_id = COALESCE(?, rzp_payment_id), updated_at = ? WHERE id = ? AND status != 'paid'")
    .run(rzpPaymentId || null, nowIso(), p.id).changes > 0;
  if (!first) return;
  if (p.kind === 'booking') {
    db.prepare("UPDATE bookings SET payment_status = 'paid' WHERE id = ?").run(p.ref_id);
    await openBooking(p.ref_id);
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
  db.prepare("UPDATE contractors SET plan_status = 'active', plan_since = ?, rzp_subscription_id = COALESCE(?, rzp_subscription_id) WHERE user_id = ?")
    .run(todayIST(), subscriptionId || null, contractorId);
  await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'planStarted', params: { amount: rupees(getSettings().contractor_plan) } });
}

function deactivateBySubscription(subscriptionId) {
  db.prepare("UPDATE workers SET membership_status = 'none' WHERE rzp_subscription_id = ?").run(subscriptionId);
  db.prepare("UPDATE contractors SET plan_status = 'none' WHERE rzp_subscription_id = ?").run(subscriptionId);
}

/** Worker accepts a job. Runs in one transaction so a booking can never be over-filled. */
async function acceptJob(workerId, bookingId) {
  const worker = getWorker(workerId);
  if (!worker) throw new HttpError(403, 'Create your worker profile first.', 'no_profile');
  const eligible = eligibleJobs(worker).some(b => b.id === bookingId);
  if (!eligible) throw new HttpError(409, 'This job is no longer available to you.', 'not_available');
  const result = db.transaction(() => {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!b || b.status !== 'open') throw new HttpError(409, 'This job was just filled.', 'filled');
    const n = activeCount(bookingId);
    if (n >= b.count) throw new HttpError(409, 'This job was just filled.', 'filled');
    db.prepare("INSERT INTO assignments (booking_id, worker_id, status, assigned_at) VALUES (?, ?, 'active', ?)").run(bookingId, workerId, nowIso());
    const full = n + 1 >= b.count;
    if (full) db.prepare("UPDATE bookings SET status = 'assigned' WHERE id = ?").run(bookingId);
    return { booking: b, full };
  })();
  const b = result.booking;
  const c = getContractor(b.contractor_id);
  await wa.sendTemplate({ userId: worker.user_id, phone: worker.phone, lang: worker.lang, templateKey: 'jobConfirmed',
    params: { skill: skillLabel(b, worker.lang), site: b.site, date: formatDate(b.start_date), company: c.company, phone: c.phone } });
  if (result.full) {
    await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'teamReady',
      params: { count: b.count, skill: skillLabel(b, c.lang), site: b.site, date: formatDate(b.start_date) } });
  }
  return { full: result.full };
}

function validateBookingInput(body) {
  const count = Number(body.count), days = Number(body.days);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw bad('Number of workers must be between 1 and 100.');
  if (!Number.isInteger(days) || days < 1 || days > 90) throw bad('Number of days must be between 1 and 90.');
  const level = LEVELS.includes(body.level) ? body.level : 'any';
  const payMode = body.payMode === 'direct' ? 'direct' : 'lk';
  const site = String(body.site || '').trim();
  if (!site) throw bad('Enter the site name and area.');
  if (site.length > 160) throw bad('Site name is too long.');
  const start = String(body.startDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < todayIST()) throw bad('Choose a start date from today onwards.');
  return { count, days, level, qc: Boolean(body.qc), payMode, site, start, skillId: String(body.skillId || '') };
}

function createBooking(contractorId, body) {
  const input = validateBookingInput(body);
  const skill = db.prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(input.skillId);
  if (!skill) throw bad('Choose a type of work.');
  const c = getContractor(contractorId);
  if (!c) throw new HttpError(403, 'Create your company profile first.', 'no_profile');
  const q = quote(getSettings(), skill, input, contractorPlanActive(c));
  const bookingId = id('bk');
  const needsPayment = q.amountDue > 0;
  db.prepare(`INSERT INTO bookings (id, contractor_id, skill_id, skill_en, skill_hi, skill_mr, count, days, level, qc, pay_mode, site, start_date,
      wage, price, job_fee, qc_cost, total, fee_now, wages_you, amount_due, payment_status, status, created_at)
    VALUES (@id, @contractor_id, @skill_id, @skill_en, @skill_hi, @skill_mr, @count, @days, @level, @qc, @pay_mode, @site, @start_date,
      @wage, @price, @job_fee, @qc_cost, @total, @fee_now, @wages_you, @amount_due, @payment_status, @status, @created_at)`).run({
    id: bookingId, contractor_id: contractorId, skill_id: skill.id, skill_en: skill.en, skill_hi: skill.hi, skill_mr: skill.mr,
    count: input.count, days: input.days, level: input.level, qc: input.qc ? 1 : 0, pay_mode: input.payMode, site: input.site, start_date: input.start,
    wage: q.wage, price: q.price, job_fee: q.jobFee, qc_cost: q.qcCost, total: q.total, fee_now: q.feeNow, wages_you: q.wagesYou, amount_due: q.amountDue,
    payment_status: needsPayment ? 'pending' : 'not_required', status: needsPayment ? 'pending_payment' : 'open', created_at: nowIso(),
  });
  return { bookingId, amountDue: q.amountDue, needsPayment };
}

module.exports = {
  quote, getContractor, getWorker, workerSkillIds, eligibleJobs, acceptJob, createBooking, openBooking,
  fulfilPayment, activateWorkerMembership, activateContractorPlan, deactivateBySubscription,
  contractorPlanActive, workerDailyWage, skillLabel, activeCount, broadcastJobOffer,
};
