'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { db, getSettings } = require('../db');
const { id, nowIso, normalizePhone, bad, str, HttpError } = require('../util');
const auth = require('../auth');
const wa = require('../services/whatsapp');
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
  const portal = ['worker', 'contractor'].includes(req.body.portal) ? req.body.portal : null;
  if (!portal) throw bad('Choose Login as Worker or Login as Builder first.', 'no_portal');
  const existing = db.prepare('SELECT role FROM users WHERE phone = ?').get(phone);
  if (existing && existing.role && existing.role !== portal) {
    throw new HttpError(403, existing.role === 'worker'
      ? 'This number is registered as a worker. Please use Login as Worker.'
      : 'This number is registered as a builder. Please use Login as Builder.', 'wrong_portal');
  }
  auth.checkOtp(phone, req.body.code);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const lang = ['en', 'hi', 'mr'].includes(req.body.lang) ? req.body.lang : 'en';
    user = { id: id('u'), phone, role: portal, lang, created_at: nowIso() };
    db.prepare('INSERT INTO users (id, phone, role, lang, created_at) VALUES (@id, @phone, @role, @lang, @created_at)').run(user);
  } else if (!user.role) {
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
    adminSession: Boolean(req.adminSession), adminPasswordLogin: Boolean(config.adminPassword),
  };
  if (!req.user) return res.json(Object.assign(base, { user: null }));
  const u = req.user;
  let contractor = u.role === 'contractor' ? getContractor(u.id) || null : null;
  if (contractor) contractor = Object.assign({}, contractor, { access: contractorPlanActive(contractor), planPrice: contractorPlanPrice(contractor, settings) });
  let worker = u.role === 'worker' ? getWorker(u.id) || null : null;
  if (worker) worker = Object.assign({}, worker, { skills: workerSkillIds(u.id), access: workerHasAccess(worker), monthlyPrice: workerMonthlyPrice(worker, settings), cashPrice: workerCashPrice(worker, settings) });
  let name = '';
  if (u.actingAs) name = contractor ? contractor.company : worker ? worker.name : u.phone;
  res.json(Object.assign(base, { user: { id: u.id, phone: u.phone, role: u.role, lang: u.lang, isAdmin: Boolean(u.isAdmin), actingAs: Boolean(u.actingAs), name }, contractor, worker }));
});

r.post('/me/role', auth.requireUser, (req, res) => {
  if (req.user.role) throw bad('Your account type is already set.', 'role_set');
  const role = req.body.role;
  if (!['worker', 'contractor'].includes(role)) throw bad('Choose worker or contractor.');
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
  db.prepare(`INSERT INTO contractors (user_id, company, gst, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET company = excluded.company, gst = excluded.gst`).run(req.user.id, company, gst, nowIso());
  res.json({ ok: true });
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
  db.transaction(() => {
    db.prepare(`INSERT INTO workers (user_id, name, area, experience, upi_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, area = excluded.area, experience = excluded.experience, upi_id = excluded.upi_id`)
      .run(req.user.id, name, area, experience, upi, nowIso());
    db.prepare('DELETE FROM worker_skills WHERE worker_id = ?').run(req.user.id);
    const ins = db.prepare('INSERT INTO worker_skills (worker_id, skill_id) VALUES (?, ?)');
    valid.forEach(s => ins.run(req.user.id, s));
  })();
  res.json({ ok: true });
});

r.get('/messages', auth.requireUser, (req, res) => {
  res.json({ messages: db.prepare('SELECT id, template, body, status, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id) });
});

module.exports = r;
