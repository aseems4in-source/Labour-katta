'use strict';
// Admin and supervisor panel. The main admin (ADMIN_USERNAME/ADMIN_PASSWORD) can do everything.
// Supervisors log in with their own username and get the permissions of their group.
const config = require('../config');
const { db, getSettings, DEFAULT_SETTINGS } = require('../db');
const { id, nowIso, todayIST, normalizePhone, bad, str, int, HttpError } = require('../util');
const auth = require('../auth');
const domain = require('../domain');
const rzp = require('../services/razorpay');
const quality = require('../quality');
const reports = require('../reports');

const r = require('../router')();
r.use(auth.requireAdmin);
const can = auth.requirePerm;

// ---------- overview (everyone in the panel) ----------
/** Platform-wide "today's site summary". */
function todaySummary() {
  const today = todayIST();
  const lines = db.prepare(`SELECT * FROM bookings WHERE status IN ('open','assigned') AND start_date <= ? AND date(start_date, '+' || (days - 1) || ' days') >= ?`).all(today, today);
  const t = { sites: new Set(lines.map(b => b.group_id)).size, expected: 0, present: 0, late: 0, absent: 0, checkedIn: 0, notCheckedIn: 0 };
  for (const b of lines) {
    for (const m of db.prepare(`SELECT (SELECT status FROM attendance x WHERE x.booking_id = a.booking_id AND x.worker_id = a.worker_id AND x.date = ?) AS st,
        (SELECT 1 FROM checkins k WHERE k.booking_id = a.booking_id AND k.worker_id = a.worker_id AND k.date = ?) AS ci
      FROM assignments a WHERE a.booking_id = ? AND a.status = 'active'`).all(today, today, b.id)) {
      t.expected++; if (m.st) t[m.st]++; else if (m.ci) t.checkedIn++; else t.notCheckedIn++;
    }
  }
  return t;
}
r.get('/overview', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  const live = 'u.deleted_at IS NULL';
  res.json({
    workers: one(`SELECT COUNT(*) AS n FROM workers w JOIN users u ON u.id = w.user_id WHERE ${live}`),
    activeMembers: one(`SELECT COUNT(*) AS n FROM workers w JOIN users u ON u.id = w.user_id WHERE ${live} AND membership_status = 'active'`),
    pendingCash: one(`SELECT COUNT(*) AS n FROM workers w JOIN users u ON u.id = w.user_id WHERE ${live} AND membership_status = 'pending_cash'`),
    contractors: one(`SELECT COUNT(*) AS n FROM contractors c JOIN users u ON u.id = c.user_id WHERE ${live}`),
    activePlans: one(`SELECT COUNT(*) AS n FROM contractors c JOIN users u ON u.id = c.user_id WHERE ${live} AND plan_status = 'active'`),
    openBookings: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'open'"),
    paidTotal: db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE status = 'paid' AND test = 0").get().n,
    openReports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    urgentReports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open' AND urgent = 1"),
    today: todaySummary(),
    myWorkload: req.admin.staffId ? one("SELECT COUNT(DISTINCT group_id) AS n FROM bookings WHERE supervisor_id = ? AND status != 'cancelled'", req.admin.staffId) : null,
    integrations: { payments: config.razorpay.live ? 'live' : 'test', whatsapp: config.whatsapp.live ? 'live' : 'test', webhookSecret: Boolean(config.razorpay.webhookSecret) },
  });
});

// ---------- prices and skills ----------
r.get('/settings', can('pricing'), (req, res) => res.json({ settings: getSettings() }));
r.put('/settings', can('pricing'), (req, res) => {
  const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  db.transaction(() => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (req.body[key] === undefined) continue;
      const max = { worker_membership_required: 1, reminder_hour: 23, confirm_hours_before: 12, ot_multiplier: 5 }[key] || 1000000;
      up.run(String(int(req.body[key], { min: 0, max, name: key })), key);
    }
  })();
  res.json({ settings: getSettings() });
});

r.get('/skills', (req, res) => res.json({ skills: db.prepare('SELECT * FROM skills WHERE active = 1 ORDER BY cat, en').all() }));
r.post('/skills', can('pricing'), (req, res) => {
  const row = {
    id: id('sk'), en: str(req.body.en, { name: 'English name', max: 60 }), hi: str(req.body.hi, { name: 'Hindi name', max: 60, required: false }),
    mr: str(req.body.mr, { name: 'Marathi name', max: 60, required: false }), cat: req.body.cat === 'unskilled' ? 'unskilled' : 'skilled',
    wage: int(req.body.wage, { min: 1, max: 100000, name: 'Wage' }), created_at: nowIso(),
  };
  db.prepare('INSERT INTO skills (id, en, hi, mr, cat, wage, created_at) VALUES (@id, @en, @hi, @mr, @cat, @wage, @created_at)').run(row);
  res.json({ skill: row });
});
r.patch('/skills/:id', can('pricing'), (req, res) => {
  const s = db.prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(req.params.id);
  if (!s) throw new HttpError(404, 'Skill not found.', 'not_found');
  const next = {
    en: req.body.en !== undefined ? str(req.body.en, { name: 'English name', max: 60 }) : s.en,
    hi: req.body.hi !== undefined ? str(req.body.hi, { name: 'Hindi name', max: 60, required: false }) : s.hi,
    mr: req.body.mr !== undefined ? str(req.body.mr, { name: 'Marathi name', max: 60, required: false }) : s.mr,
    cat: req.body.cat !== undefined ? (req.body.cat === 'unskilled' ? 'unskilled' : 'skilled') : s.cat,
    wage: req.body.wage !== undefined ? int(req.body.wage, { min: 1, max: 100000, name: 'Wage' }) : s.wage,
  };
  db.prepare('UPDATE skills SET en = ?, hi = ?, mr = ?, cat = ?, wage = ? WHERE id = ?').run(next.en, next.hi, next.mr, next.cat, next.wage, s.id);
  res.json({ ok: true });
});
// Removing a skill hides it from new bookings and sign-ups; past bookings keep their copy of the name and price.
r.delete('/skills/:id', can('pricing'), (req, res) => {
  db.prepare('UPDATE skills SET active = 0 WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM worker_skills WHERE skill_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- shared helpers for profiles ----------
function phoneFor(value, exceptUserId) {
  const phone = normalizePhone(value);
  if (!phone) throw bad('Enter a valid 10-digit Indian mobile number.', 'bad_phone');
  const taken = db.prepare('SELECT id, role FROM users WHERE phone = ? AND id != ?').get(phone, exceptUserId || '');
  if (taken) throw bad(`This number is already registered as a ${taken.role === 'worker' ? 'worker' : 'builder'}.`, 'phone_taken');
  return phone;
}
function validSkills(list) {
  const skills = Array.isArray(list) ? [...new Set(list.map(String))] : [];
  const valid = skills.length ? db.prepare(`SELECT id FROM skills WHERE active = 1 AND id IN (${skills.map(() => '?').join(',')})`).all(...skills).map(s => s.id) : [];
  if (!valid.length) throw bad('Choose at least one type of work.');
  return valid;
}
const EXP = ['0-1', '1-3', '3-5', '5+'];

// ---------- workers ----------
r.get('/workers', can('workers'), (req, res) => {
  const rows = db.prepare('SELECT w.*, u.phone FROM workers w JOIN users u ON u.id = w.user_id WHERE u.deleted_at IS NULL ORDER BY w.created_at DESC LIMIT 2000').all();
  const skills = db.prepare('SELECT skill_id FROM worker_skills WHERE worker_id = ?');
  const coupon = db.prepare('SELECT c.code FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE r.user_id = ?');
  res.json({ workers: rows.map(w => Object.assign(w, { skills: skills.all(w.user_id).map(s => s.skill_id), coupon: (coupon.get(w.user_id) || {}).code || '', rating: quality.ratingOf(w.user_id), reliability: quality.reliability(w.user_id), computedTier: quality.computeTier(Object.assign({}, w, { tier_cap: 'gold' })) })) });
});
r.post('/workers', can('workers'), (req, res) => {
  const phone = phoneFor(req.body.phone);
  const name = str(req.body.name, { name: 'Name', max: 80 });
  const area = str(req.body.area, { name: 'Area', max: 80, required: false });
  const experience = EXP.includes(req.body.experience) ? req.body.experience : '';
  const skills = validSkills(req.body.skills);
  const coupon = str(req.body.coupon, { name: 'Coupon code', max: 40, required: false });
  if (coupon) domain.findCoupon(coupon, 'worker');
  const uid = id('u');
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, phone, role, lang, created_at) VALUES (?, ?, 'worker', 'en', ?)").run(uid, phone, nowIso());
    db.prepare('INSERT INTO workers (user_id, name, area, experience, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, name, area, experience, nowIso());
    const ins = db.prepare('INSERT INTO worker_skills (worker_id, skill_id) VALUES (?, ?)');
    skills.forEach(s => ins.run(uid, s));
  })();
  const applied = coupon ? domain.redeemCoupon(uid, 'worker', coupon) : null;
  res.json({ ok: true, id: uid, coupon: applied });
});
r.patch('/workers/:id', can('workers'), (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w || w.membership_status === 'deleted') throw new HttpError(404, 'Worker not found.', 'not_found');
  const sets = [], vals = [];
  const b = req.body;
  if (b.name !== undefined) { sets.push('name = ?'); vals.push(str(b.name, { name: 'Name', max: 80 })); }
  if (b.area !== undefined) { sets.push('area = ?'); vals.push(str(b.area, { name: 'Area', max: 80, required: false })); }
  if (b.experience !== undefined) { sets.push('experience = ?'); vals.push(EXP.includes(b.experience) ? b.experience : ''); }
  // Levels are earned automatically. The admin can only cap a worker lower (tier_cap), never raise it past the records.
  if (b.tier_cap !== undefined || b.tier !== undefined) { const cap = b.tier_cap !== undefined ? b.tier_cap : b.tier; if (!['bronze', 'silver', 'gold'].includes(cap)) throw bad('Unknown level.'); sets.push('tier_cap = ?'); vals.push(cap); }
  if (b.custom_wage !== undefined) { sets.push('custom_wage = ?'); vals.push(b.custom_wage === null || b.custom_wage === '' ? null : int(b.custom_wage, { min: 1, max: 100000, name: 'Custom wage' })); }
  for (const k of ['verified_aadhaar', 'verified_photo', 'verified_bank', 'verified_test', 'available']) {
    if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k] ? 1 : 0); }
  }
  if (b.available !== undefined) { sets.push('avail_status = ?'); vals.push(b.available ? 'available' : 'unavailable'); }
  const phone = b.phone !== undefined ? phoneFor(b.phone, w.user_id) : null;
  const skills = b.skills !== undefined ? validSkills(b.skills) : null;
  db.transaction(() => {
    if (sets.length) db.prepare(`UPDATE workers SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, w.user_id);
    if (phone) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, w.user_id);
    if (skills) {
      db.prepare('DELETE FROM worker_skills WHERE worker_id = ?').run(w.user_id);
      const ins = db.prepare('INSERT INTO worker_skills (worker_id, skill_id) VALUES (?, ?)');
      skills.forEach(s => ins.run(w.user_id, s));
    }
  })();
  quality.recomputeTier(w.user_id);
  res.json({ ok: true });
});
r.delete('/workers/:id', can('workers'), async (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w || w.membership_status === 'deleted') throw new HttpError(404, 'Worker not found.', 'not_found');
  if (w.rzp_subscription_id && config.razorpay.live && w.membership_status === 'active') { try { await rzp.cancelSubscription(w.rzp_subscription_id); } catch (e) { console.error('[delete] cancel subscription', e.message); } }
  res.json(Object.assign({ ok: true }, await domain.deleteWorker(w.user_id)));
});
r.post('/workers/:id/cash-received', can('workers'), async (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w) throw new HttpError(404, 'Worker not found.', 'not_found');
  const amount = domain.workerCashPrice(w, getSettings());
  db.prepare(`INSERT INTO payments (id, user_id, kind, ref_id, amount, status, test, created_at, updated_at)
    VALUES (?, ?, 'worker_membership', ?, ?, 'paid', 0, ?, ?)`).run(id('pay'), w.user_id, w.user_id, amount, nowIso(), nowIso());
  await domain.activateWorkerMembership(w.user_id, 'cash', null);
  res.json({ ok: true });
});
const trialUntil = (days) => todayIST(int(days, { min: 1, max: 365, name: 'Trial days' }));
r.post('/workers/:id/trial', can('workers'), (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w) throw new HttpError(404, 'Worker not found.', 'not_found');
  if (w.membership_status === 'active') throw bad('This worker already has a paid membership.');
  const until = trialUntil(req.body.days);
  db.prepare("UPDATE workers SET membership_status = 'trial', trial_until = ? WHERE user_id = ?").run(until, w.user_id);
  res.json({ ok: true, trial_until: until });
});
r.post('/workers/:id/price', can('workers'), (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w) throw new HttpError(404, 'Worker not found.', 'not_found');
  const v = req.body.price === null || req.body.price === '' ? null : int(req.body.price, { min: 1, max: 100000, name: 'Special price' });
  db.prepare('UPDATE workers SET custom_price = ? WHERE user_id = ?').run(v, w.user_id);
  res.json({ ok: true });
});

// ---------- builders (contractors) ----------
r.get('/contractors', can('builders'), (req, res) => {
  const rows = db.prepare('SELECT c.*, u.phone FROM contractors c JOIN users u ON u.id = c.user_id WHERE u.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 2000').all();
  const coupon = db.prepare('SELECT c.code FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE r.user_id = ?');
  res.json({ contractors: rows.map(c => Object.assign(c, { coupon: (coupon.get(c.user_id) || {}).code || '', vflags: quality.cFlags(c), reportsAgainst: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE against_user = ? AND status = 'open'").get(c.user_id).n })) });
});
r.post('/contractors', can('builders'), (req, res) => {
  const phone = phoneFor(req.body.phone);
  const company = str(req.body.company, { name: 'Company name', max: 120 });
  const gst = str(req.body.gst, { name: 'GST number', max: 20, required: false }).toUpperCase();
  const coupon = str(req.body.coupon, { name: 'Coupon code', max: 40, required: false });
  if (coupon) domain.findCoupon(coupon, 'contractor');
  const uid = id('u');
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, phone, role, lang, created_at) VALUES (?, ?, 'contractor', 'en', ?)").run(uid, phone, nowIso());
    db.prepare('INSERT INTO contractors (user_id, company, gst, created_at) VALUES (?, ?, ?, ?)').run(uid, company, gst, nowIso());
  })();
  const applied = coupon ? domain.redeemCoupon(uid, 'contractor', coupon) : null;
  res.json({ ok: true, id: uid, coupon: applied });
});
r.patch('/contractors/:id', can('builders'), (req, res) => {
  const c = domain.getContractor(req.params.id);
  if (!c || c.plan_status === 'deleted') throw new HttpError(404, 'Builder not found.', 'not_found');
  const company = req.body.company !== undefined ? str(req.body.company, { name: 'Company name', max: 120 }) : c.company;
  const gst = req.body.gst !== undefined ? str(req.body.gst, { name: 'GST number', max: 20, required: false }).toUpperCase() : c.gst;
  const phone = req.body.phone !== undefined ? phoneFor(req.body.phone, c.user_id) : null;
  const vf = {};
  for (const k of ['verified_id', 'verified_gst', 'verified_site']) {
    if (req.body[k] === undefined) continue;
    if (!(req.admin.root || req.admin.perms.includes('disputes') || req.admin.perms.includes('builders'))) throw new HttpError(403, 'You do not have permission for this.', 'no_permission');
    vf[k] = req.body[k] ? 1 : 0;
  }
  db.transaction(() => {
    db.prepare('UPDATE contractors SET company = ?, gst = ? WHERE user_id = ?').run(company, gst, c.user_id);
    for (const k of Object.keys(vf)) db.prepare(`UPDATE contractors SET ${k} = ? WHERE user_id = ?`).run(vf[k], c.user_id);
    if (phone) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, c.user_id);
  })();
  res.json({ ok: true });
});
r.delete('/contractors/:id', can('builders'), async (req, res) => {
  const c = domain.getContractor(req.params.id);
  if (!c || c.plan_status === 'deleted') throw new HttpError(404, 'Builder not found.', 'not_found');
  if (c.rzp_subscription_id && config.razorpay.live && c.plan_status === 'active') { try { await rzp.cancelSubscription(c.rzp_subscription_id); } catch (e) { console.error('[delete] cancel subscription', e.message); } }
  const open = db.prepare("SELECT id FROM bookings WHERE contractor_id = ? AND status IN ('open','assigned')").all(c.user_id).map(x => x.id);
  await domain.notifyCancelled(open);
  res.json(Object.assign({ ok: true }, domain.deleteContractor(c.user_id)));
});
r.post('/contractors/:id/trial', can('builders'), (req, res) => {
  const c = domain.getContractor(req.params.id);
  if (!c) throw new HttpError(404, 'Builder not found.', 'not_found');
  if (c.plan_status === 'active') throw bad('This builder already has a paid plan.');
  const until = trialUntil(req.body.days);
  db.prepare("UPDATE contractors SET plan_status = 'trial', trial_until = ? WHERE user_id = ?").run(until, c.user_id);
  res.json({ ok: true, trial_until: until });
});
r.post('/contractors/:id/price', can('builders'), (req, res) => {
  const c = domain.getContractor(req.params.id);
  if (!c) throw new HttpError(404, 'Builder not found.', 'not_found');
  const v = req.body.price === null || req.body.price === '' ? null : int(req.body.price, { min: 1, max: 100000, name: 'Special price' });
  db.prepare('UPDATE contractors SET custom_price = ? WHERE user_id = ?').run(v, c.user_id);
  res.json({ ok: true });
});

// Open a builder's or worker's portal as that account.
r.post('/act-as', can('open_portals'), (req, res) => {
  const u = db.prepare('SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL').get(String(req.body.userId || ''));
  if (!u || !u.role) throw new HttpError(404, 'Account not found.', 'not_found');
  auth.setActAs(res, u.id);
  res.json({ ok: true, role: u.role });
});

// ---------- bookings and supervisor workload ----------
const bookingRows = (where, ...args) => db.prepare(`SELECT b.*, c.company, u.phone AS builder_phone, s.name AS supervisor_name
  FROM bookings b JOIN contractors c ON c.user_id = b.contractor_id JOIN users u ON u.id = b.contractor_id
  LEFT JOIN staff_users s ON s.id = b.supervisor_id ${where} ORDER BY b.start_date DESC, b.created_at DESC LIMIT 500`).all(...args)
  .map(b => Object.assign(b, { assigned: domain.activeCount(b.id) }));
r.get('/bookings', can('bookings'), (req, res) => res.json({ bookings: bookingRows('') }));
// Staff names for the "assign supervisor" dropdown.
r.get('/staff-names', can('bookings'), (req, res) => res.json({ staff: db.prepare('SELECT id, name FROM staff_users WHERE active = 1 ORDER BY name').all() }));
// Assign a whole order (site) to a supervisor, or clear it with staffId null.
r.post('/bookings/:id/supervisor', can('bookings'), (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) throw new HttpError(404, 'Booking not found.', 'not_found');
  const sid = req.body.staffId ? String(req.body.staffId) : null;
  if (sid && !db.prepare('SELECT 1 FROM staff_users WHERE id = ? AND active = 1').get(sid)) throw bad('Choose an active supervisor.');
  db.prepare('UPDATE bookings SET supervisor_id = ? WHERE group_id = ?').run(sid, b.group_id);
  res.json({ ok: true });
});
// A supervisor's own workload, with each team and phone numbers.
r.get('/my-work', (req, res) => {
  if (!req.admin.staffId) return res.json({ bookings: [] });
  const team = db.prepare(`SELECT a.worker_id, w.name, w.tier, u.phone,
      (SELECT status FROM attendance t WHERE t.booking_id = a.booking_id AND t.worker_id = a.worker_id AND t.date = ?) AS today,
      (SELECT at FROM checkins k WHERE k.booking_id = a.booking_id AND k.worker_id = a.worker_id AND k.date = ?) AS checkin
    FROM assignments a JOIN workers w ON w.user_id = a.worker_id JOIN users u ON u.id = a.worker_id
    WHERE a.booking_id = ? AND a.status = 'active' ORDER BY a.assigned_at`);
  const rows = bookingRows("WHERE b.supervisor_id = ? AND b.status != 'cancelled'", req.admin.staffId);
  res.json({ today: todayIST(), bookings: rows.map(b => Object.assign(b, { team: team.all(todayIST(), todayIST(), b.id) })) });
});
// Supervisors mark attendance on the bookings assigned to them.
r.post('/my-work/:id/attendance', (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b || (!req.admin.root && b.supervisor_id !== req.admin.staffId)) throw new HttpError(404, 'Booking not found.', 'not_found');
  require('./work').markAttendance(b, req.body);
  res.json({ ok: true });
});
// Urgent message to everyone on a site: admins with the bookings permission, or the site's supervisor.
r.post('/bookings/:id/notice', async (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  const allowed = b && (req.admin.root || req.admin.perms.includes('bookings') || b.supervisor_id === req.admin.staffId);
  if (!allowed) throw new HttpError(404, 'Booking not found.', 'not_found');
  res.json({ ok: true, sentTo: await require('./more').sendNotice(b.group_id, req.body.text, req.admin.staffId || 'admin') });
});

// ---------- reports, disputes and reviews ----------
r.get('/reports', can('disputes'), (req, res) => {
  const rows = reports.listReports('');
  for (const x of rows) if (x.kind === 'rating' && x.booking_id) x.rating = db.prepare('SELECT stars, comment, dispute, dispute_status FROM ratings WHERE booking_id = ? AND worker_id = ?').get(x.booking_id, x.from_user) || null;
  res.json({ reports: rows });
});
r.post('/reports/:id/resolve', can('disputes'), (req, res) => {
  const rp = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!rp) throw new HttpError(404, 'Report not found.', 'not_found');
  const resolution = str(req.body.resolution, { name: 'What was decided', max: 500 });
  db.transaction(() => {
    db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(resolution, req.admin.staffId || 'admin', nowIso(), rp.id);
    if (rp.kind === 'rating' && rp.booking_id) {
      const outcome = req.body.ratingAction === 'remove' ? 'removed' : 'kept';
      db.prepare('UPDATE ratings SET dispute_status = ? WHERE booking_id = ? AND worker_id = ?').run(outcome, rp.booking_id, rp.from_user);
    }
  })();
  if (rp.kind === 'rating') quality.recomputeTier(rp.from_user);
  res.json({ ok: true });
});

r.get('/payments', can('payments'), (req, res) => res.json({ payments: db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 500').all() }));
r.get('/notifications', can('payments'), (req, res) => res.json({ notifications: db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 300').all() }));

// ---------- coupons ----------
r.get('/coupons', can('coupons'), (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS uses FROM coupons c ORDER BY c.created_at DESC`).all();
  res.json({ coupons: rows });
});
r.post('/coupons', can('coupons'), (req, res) => {
  const code = str(req.body.code, { name: 'Code', max: 30 }).toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw bad('Code must be 3–30 letters or numbers, without spaces.');
  if (db.prepare('SELECT 1 FROM coupons WHERE code = ? COLLATE NOCASE').get(code)) throw bad('This code already exists.');
  const appliesTo = ['builder', 'worker', 'both'].includes(req.body.applies_to) ? req.body.applies_to : 'both';
  const kind = ['percent', 'flat', 'days'].includes(req.body.kind) ? req.body.kind : 'percent';
  const value = int(req.body.value, { min: 1, max: kind === 'percent' ? 99 : kind === 'days' ? 365 : 100000, name: kind === 'percent' ? 'Percent off' : kind === 'days' ? 'Free days' : 'Amount off' });
  const maxUses = req.body.max_uses === '' || req.body.max_uses == null ? null : int(req.body.max_uses, { min: 1, max: 1000000, name: 'Maximum uses' });
  const expires = req.body.expires ? String(req.body.expires) : null;
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw bad('Choose a valid expiry date.');
  const row = { id: id('cp'), code, applies_to: appliesTo, kind, value, max_uses: maxUses, expires, note: str(req.body.note, { name: 'Note', max: 120, required: false }), created_at: nowIso() };
  db.prepare('INSERT INTO coupons (id, code, applies_to, kind, value, max_uses, expires, note, created_at) VALUES (@id, @code, @applies_to, @kind, @value, @max_uses, @expires, @note, @created_at)').run(row);
  res.json({ coupon: row });
});
r.patch('/coupons/:id', can('coupons'), (req, res) => {
  if (req.body.active !== undefined) db.prepare('UPDATE coupons SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
r.delete('/coupons/:id', can('coupons'), (req, res) => {
  // Accounts that already used it keep their discount.
  db.prepare('UPDATE coupons SET active = 0, code = code || \'-DEL-\' || id WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- supervisor groups and users (main admin only) ----------
const cleanPerms = (list) => (Array.isArray(list) ? list : []).filter(p => auth.ALL_PERMS.includes(p));
r.get('/staff', auth.requireRoot, (req, res) => {
  const groups = db.prepare('SELECT * FROM staff_groups ORDER BY name').all().map(g => Object.assign(g, { perms: JSON.parse(g.perms || '[]') }));
  const users = db.prepare(`SELECT s.id, s.name, s.username, s.phone, s.group_id, s.active, s.created_at,
      (SELECT COUNT(DISTINCT b.group_id) FROM bookings b WHERE b.supervisor_id = s.id AND b.status NOT IN ('cancelled')) AS workload
    FROM staff_users s ORDER BY s.name`).all();
  res.json({ perms: auth.PERMS, groups, users });
});
r.post('/staff/groups', auth.requireRoot, (req, res) => {
  const name = str(req.body.name, { name: 'Group name', max: 60 });
  if (db.prepare('SELECT 1 FROM staff_groups WHERE name = ?').get(name)) throw bad('A group with this name already exists.');
  const g = { id: id('grp'), name, perms: JSON.stringify(cleanPerms(req.body.perms)), created_at: nowIso() };
  db.prepare('INSERT INTO staff_groups (id, name, perms, created_at) VALUES (@id, @name, @perms, @created_at)').run(g);
  res.json({ ok: true, id: g.id });
});
r.patch('/staff/groups/:id', auth.requireRoot, (req, res) => {
  const g = db.prepare('SELECT * FROM staff_groups WHERE id = ?').get(req.params.id);
  if (!g) throw new HttpError(404, 'Group not found.', 'not_found');
  const name = req.body.name !== undefined ? str(req.body.name, { name: 'Group name', max: 60 }) : g.name;
  const perms = req.body.perms !== undefined ? JSON.stringify(cleanPerms(req.body.perms)) : g.perms;
  db.prepare('UPDATE staff_groups SET name = ?, perms = ? WHERE id = ?').run(name, perms, g.id);
  res.json({ ok: true });
});
r.delete('/staff/groups/:id', auth.requireRoot, (req, res) => {
  db.transaction(() => {
    db.prepare('UPDATE staff_users SET group_id = NULL WHERE group_id = ?').run(req.params.id);
    db.prepare('DELETE FROM staff_groups WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});
function staffPassword(pw) {
  const p = String(pw || '');
  if (p.length < 8) throw bad('Password must be at least 8 characters.');
  return auth.hashPassword(p);
}
r.post('/staff/users', auth.requireRoot, (req, res) => {
  const username = str(req.body.username, { name: 'Username', max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Username must be 3–40 letters or numbers, without spaces.');
  if (username === String(config.adminUsername).toLowerCase() || db.prepare('SELECT 1 FROM staff_users WHERE username = ?').get(username)) throw bad('This username is already taken.');
  const groupId = req.body.group_id ? String(req.body.group_id) : null;
  if (groupId && !db.prepare('SELECT 1 FROM staff_groups WHERE id = ?').get(groupId)) throw bad('Choose a valid group.');
  const phone = req.body.phone ? (normalizePhone(req.body.phone) || (() => { throw bad('Enter a valid 10-digit mobile number.'); })()) : '';
  const u = { id: id('st'), name: str(req.body.name, { name: 'Name', max: 80 }), username, pass_hash: staffPassword(req.body.password), phone, group_id: groupId, created_at: nowIso() };
  db.prepare('INSERT INTO staff_users (id, name, username, pass_hash, phone, group_id, created_at) VALUES (@id, @name, @username, @pass_hash, @phone, @group_id, @created_at)').run(u);
  res.json({ ok: true, id: u.id });
});
r.patch('/staff/users/:id', auth.requireRoot, (req, res) => {
  const u = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'Supervisor not found.', 'not_found');
  const b = req.body;
  if (b.name !== undefined) db.prepare('UPDATE staff_users SET name = ? WHERE id = ?').run(str(b.name, { name: 'Name', max: 80 }), u.id);
  if (b.group_id !== undefined) {
    const gid = b.group_id ? String(b.group_id) : null;
    if (gid && !db.prepare('SELECT 1 FROM staff_groups WHERE id = ?').get(gid)) throw bad('Choose a valid group.');
    db.prepare('UPDATE staff_users SET group_id = ? WHERE id = ?').run(gid, u.id);
  }
  if (b.active !== undefined) db.prepare('UPDATE staff_users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
  if (b.password !== undefined) db.prepare('UPDATE staff_users SET pass_hash = ? WHERE id = ?').run(staffPassword(b.password), u.id);
  res.json({ ok: true });
});
r.delete('/staff/users/:id', auth.requireRoot, (req, res) => {
  db.transaction(() => {
    db.prepare('UPDATE bookings SET supervisor_id = NULL WHERE supervisor_id = ?').run(req.params.id);
    db.prepare('DELETE FROM staff_users WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

module.exports = r;
