'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { db, getSettings } = require('../db');
const { id, nowIso, normalizePhone, bad, str, HttpError } = require('../util');
const auth = require('../auth');
const wa = require('../services/whatsapp');
const domain = require('../domain');
const quality = require('../quality');
const projects = require('../projects');
const { getContractor, getWorker, workerSkillIds, contractorPlanActive, workerHasAccess, contractorPlanPrice, workerMonthlyPrice, workerCashPrice } = require('../domain');

const r = require('../router')();
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.LOGIN_RATE_LIMIT || 20), standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'rate_limited' } });

r.post('/auth/request-otp', otpLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw bad('Enter a valid 10-digit Indian mobile number.', 'bad_phone');
  if (!config.whatsapp.live && !config.allowTestMode) throw new HttpError(503, 'Sign-in by WhatsApp is not set up yet.', 'otp_unavailable');
  const code = auth.issueOtp(phone);
  const lang = ['en', 'hi', 'mr'].includes(req.body.lang) ? req.body.lang : 'en';
  const sent = await wa.sendOtp(phone, code, lang);
  if (sent.status === 'failed') throw new HttpError(502, 'Could not send the WhatsApp code. Try again in a minute.', 'otp_send_failed');
  const out = { ok: true, channel: sent.status === 'sent' ? 'whatsapp' : 'test' };
  // Test mode only: show the code on screen because no WhatsApp provider is connected.
  if (sent.status === 'test') { out.devCode = code; console.log(`[otp:test] ${phone} -> ${code}`); }
  res.json(out);
});

r.post('/auth/verify-otp', otpLimiter, (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw bad('Enter a valid 10-digit Indian mobile number.', 'bad_phone');
  // portal given = sign-up as worker/builder. No portal = log in: the number decides which screen opens.
  const portal = ['worker', 'contractor', 'partner'].includes(req.body.portal) ? req.body.portal : null;
  const existing = db.prepare('SELECT role FROM users WHERE phone = ?').get(phone);
  if (!portal && !(existing && existing.role)) {
    auth.checkOtp(phone, req.body.code, true); // check the code first, so numbers can't be probed
    throw new HttpError(404, 'This number is not registered yet. Please sign up as a Worker or a Builder.', 'not_registered');
  }
  if (portal && existing && existing.role && existing.role !== portal) {
    throw new HttpError(403, {
      worker: 'This number is registered as a worker. Please use Login as Worker.',
      contractor: 'This number is registered as a builder. Please use Login as Builder.',
      partner: 'This number is registered as a contractor / professional. Please use Login.',
    }[existing.role], 'wrong_portal');
  }
  auth.checkOtp(phone, req.body.code);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const lang = ['en', 'hi', 'mr'].includes(req.body.lang) ? req.body.lang : 'en';
    user = { id: id('u'), phone, role: portal, lang, created_at: nowIso() };
    db.prepare('INSERT INTO users (id, phone, role, lang, created_at) VALUES (@id, @phone, @role, @lang, @created_at)').run(user);
  } else if (!user.role && portal) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(portal, user.id); user.role = portal;
  }
  auth.setSession(res, user.id);
  res.json({ ok: true });
});

r.post('/auth/logout', (req, res) => { auth.clearSession(res); auth.clearAdmin(res); res.json({ ok: true }); });

r.post('/auth/stop-acting', (req, res) => { auth.clearActAs(res); res.json({ ok: true }); });

r.post('/auth/admin-login', otpLimiter, (req, res) => {
  auth.adminLogin(req, res, String(req.body.username || '').trim(), String(req.body.password || ''));
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  const settings = getSettings();
  const skills = db.prepare('SELECT id, en, hi, mr, cat, wage FROM skills WHERE active = 1 ORDER BY cat, en').all();
  const base = {
    settings, skills,
    integrations: { payments: config.razorpay.live ? 'live' : 'test', whatsapp: config.whatsapp.live ? 'live' : 'test' },
    razorpayKeyId: config.razorpay.live ? config.razorpay.keyId : null,
    adminSession: Boolean(req.adminSession), adminPasswordLogin: true,
    admin: req.admin ? { name: req.admin.name, root: req.admin.root, group: req.admin.group || '', perms: req.admin.perms, staffId: req.admin.staffId } : null,
  };
  if (!req.user) return res.json(Object.assign(base, { user: null }));
  const u = req.user;
  let contractor = u.role === 'contractor' ? getContractor(u.id) || null : null;
  if (contractor) contractor = Object.assign({}, contractor, { access: contractorPlanActive(contractor), planPrice: contractorPlanPrice(contractor, settings) });
  let worker = u.role === 'worker' ? getWorker(u.id) || null : null;
  if (worker) worker = Object.assign({}, worker, { skills: workerSkillIds(u.id), access: workerHasAccess(worker), monthlyPrice: workerMonthlyPrice(worker, settings), cashPrice: workerCashPrice(worker, settings),
    rating: quality.ratingOf(u.id), reliability: quality.reliability(u.id), nextLevel: quality.nextLevelSteps(worker) });
  if (contractor) contractor.vflags = quality.cFlags(contractor);
  let partner = null;
  if (u.role === 'partner') {
    const pp = projects.getPartner(u.id);
    if (pp) partner = Object.assign({}, pp, { categories: projects.partnerCategoryIds(u.id), vflags: projects.pFlags(pp), stats: projects.partnerStats(u.id) });
  }
  const red = db.prepare('SELECT c.code, c.kind, c.value FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE r.user_id = ?').get(u.id);
  if (contractor) contractor.coupon = red ? { code: red.code, label: domain.couponLabel(red) } : null;
  if (worker) worker.coupon = red ? { code: red.code, label: domain.couponLabel(red) } : null;
  let name = '';
  if (u.actingAs) name = contractor ? contractor.company : worker ? worker.name : partner ? partner.company : u.phone;
  res.json(Object.assign(base, { projectFees: projects.fees(), user: { id: u.id, phone: u.phone, role: u.role, lang: u.lang, isAdmin: Boolean(u.isAdmin), actingAs: Boolean(u.actingAs), name }, contractor, worker, partner }));
});

r.post('/me/role', auth.requireUser, (req, res) => {
  if (req.user.role) throw bad('Your account type is already set.', 'role_set');
  const role = req.body.role;
  if (!['worker', 'contractor', 'partner'].includes(role)) throw bad('Choose worker, builder or contractor / professional.');
  if (req.user.role && req.user.role !== role) throw bad('This phone number is already registered with a different account type.', 'role_set');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.user.id);
  res.json({ ok: true });
});

r.post('/me/lang', auth.requireUser, (req, res) => {
  const lang = ['en', 'hi', 'mr'].includes(req.body.lang) ? req.body.lang : 'en';
  db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, req.user.id);
  res.json({ ok: true });
});

r.post('/contractor/profile', auth.requireRole('contractor'), (req, res) => {
  const company = str(req.body.company, { name: 'Company name', max: 120 });
  const gst = str(req.body.gst, { name: 'GST number', max: 20, required: false }).toUpperCase();
  const bizType = projects.BIZ_TYPES.includes(req.body.bizType) ? req.body.bizType : 'builder';
  const coupon = str(req.body.coupon, { name: 'Coupon code', max: 40, required: false });
  if (coupon) domain.findCoupon(coupon, 'contractor'); // check before saving anything
  db.prepare(`INSERT INTO contractors (user_id, company, gst, biz_type, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET company = excluded.company, gst = excluded.gst, biz_type = excluded.biz_type`).run(req.user.id, company, gst, bizType, nowIso());
  const applied = coupon ? domain.redeemCoupon(req.user.id, 'contractor', coupon) : null;
  res.json({ ok: true, coupon: applied });
});

r.post('/worker/profile', auth.requireRole('worker'), (req, res) => {
  const name = str(req.body.name, { name: 'Name', max: 80 });
  const area = str(req.body.area, { name: 'Area', max: 80, required: false });
  const experience = ['0-1', '1-3', '3-5', '5+'].includes(req.body.experience) ? req.body.experience : '';
  const upi = str(req.body.upiId, { name: 'UPI ID', max: 80, required: false });
  if (upi && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi)) throw bad('Enter a valid UPI ID, like name@bank.');
  const skills = Array.isArray(req.body.skills) ? [...new Set(req.body.skills.map(String))] : [];
  const valid = skills.length ? db.prepare(`SELECT id FROM skills WHERE active = 1 AND id IN (${skills.map(() => '?').join(',')})`).all(...skills).map(s => s.id) : [];
  if (!valid.length) throw bad('Choose at least one type of work.');
  const coupon = str(req.body.coupon, { name: 'Coupon code', max: 40, required: false });
  if (coupon) domain.findCoupon(coupon, 'worker');
  db.transaction(() => {
    db.prepare(`INSERT INTO workers (user_id, name, area, experience, upi_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, area = excluded.area, experience = excluded.experience, upi_id = excluded.upi_id`)
      .run(req.user.id, name, area, experience, upi, nowIso());
    db.prepare('DELETE FROM worker_skills WHERE worker_id = ?').run(req.user.id);
    const ins = db.prepare('INSERT INTO worker_skills (worker_id, skill_id) VALUES (?, ?)');
    valid.forEach(s => ins.run(req.user.id, s));
  })();
  const applied = coupon ? domain.redeemCoupon(req.user.id, 'worker', coupon) : null;
  quality.recomputeTier(req.user.id);
  res.json({ ok: true, coupon: applied });
});

// Apply a coupon later (before paying), if none was used at sign-up.
r.post('/coupon/apply', auth.requireUser, (req, res) => {
  const role = req.user.role;
  if (role === 'contractor' && !getContractor(req.user.id)) throw bad('Create your company profile first.');
  if (role === 'worker' && !getWorker(req.user.id)) throw bad('Create your worker profile first.');
  if (!role) throw bad('Sign up first.');
  res.json({ ok: true, coupon: domain.redeemCoupon(req.user.id, role, str(req.body.code, { name: 'Coupon code', max: 40 })) });
});

r.get('/messages', auth.requireUser, (req, res) => {
  res.json({ messages: db.prepare('SELECT id, template, body, status, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id) });
});

module.exports = r;
