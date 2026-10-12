'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { db } = require('./db');
const { HttpError } = require('./util');

const COOKIE = 'lk_session';
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 30 * 1000;

const hashCode = (phone, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${phone}:${code}`).digest('hex');

function issueOtp(phone) {
  const existing = db.prepare('SELECT sent_at FROM otps WHERE phone = ?').get(phone);
  if (existing && Date.now() - existing.sent_at < OTP_RESEND_MS) throw new HttpError(429, 'Please wait 30 seconds before asking for a new code.', 'otp_wait');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare(`INSERT INTO otps (phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`)
    .run(phone, hashCode(phone, code), Date.now() + OTP_TTL_MS, Date.now());
  return code;
}

function checkOtp(phone, code) {
  const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'This code has expired. Ask for a new one.', 'otp_expired');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.', 'otp_locked');
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashCode(phone, String(code || '').trim())));
  if (!ok) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    throw new HttpError(400, 'That code is not right. Check the WhatsApp message and try again.', 'otp_wrong');
  }
  db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
}

// ---- admin username/password login ----
const ADMIN_COOKIE = 'lk_admin';
const ACT_COOKIE = 'lk_actas';
const adminFails = new Map(); // ip -> { n, until }
function adminLogin(req, res, username, password) {
  const ip = req.ip || 'x';
  const f = adminFails.get(ip);
  if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong attempts. Try again in 15 minutes.', 'admin_locked');
  if (!config.adminPassword) throw new HttpError(503, 'Admin password login is not set up on the server.', 'admin_disabled');
  const digest = (s) => crypto.createHash('sha256').update(String(s || '')).digest();
  const ok = crypto.timingSafeEqual(digest(username), digest(config.adminUsername)) & crypto.timingSafeEqual(digest(password), digest(config.adminPassword));
  if (!ok) {
    const n = (f && f.until <= Date.now() ? 0 : (f ? f.n : 0)) + 1;
    adminFails.set(ip, { n, until: n >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
    throw new HttpError(401, 'Wrong username or password.', 'admin_wrong');
  }
  adminFails.delete(ip);
  const token = jwt.sign({ adm: 1 }, config.jwtSecret, { expiresIn: '12h' });
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 12 * 3600 * 1000, path: '/' });
}
function clearAdmin(res) { res.clearCookie(ADMIN_COOKIE, { path: '/' }); res.clearCookie(ACT_COOKIE, { path: '/' }); }
// Admin opens a contractor or worker portal as that account.
function setActAs(res, userId) {
  res.cookie(ACT_COOKIE, jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '12h' }), { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 12 * 3600 * 1000, path: '/' });
}
function clearActAs(res) { res.clearCookie(ACT_COOKIE, { path: '/' }); }

function setSession(res, userId) {
  const token = jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '60d' });
  res.cookie(COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 60 * 86400 * 1000, path: '/' });
}
function clearSession(res) { res.clearCookie(COOKIE, { path: '/' }); }

const isAdminPhone = (phone) => config.adminPhones.includes(phone);

function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    try {
      const { uid } = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (user) { user.isAdmin = isAdminPhone(user.phone); req.user = user; }
    } catch (_) { /* expired or tampered cookie: treat as signed out */ }
  }
  const adm = req.cookies && req.cookies[ADMIN_COOKIE];
  if (adm && config.adminPassword) {
    try { if (jwt.verify(adm, config.jwtSecret).adm === 1) req.adminSession = true; } catch (_) { /* expired */ }
  }
  const act = req.cookies && req.cookies[ACT_COOKIE];
  if (act && (req.adminSession || (req.user && req.user.isAdmin))) {
    try {
      const { uid } = jwt.verify(act, config.jwtSecret);
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (target) { target.isAdmin = true; target.actingAs = true; req.adminSession = true; req.user = target; }
    } catch (_) { /* expired */ }
  }
  next();
}
function requireUser(req, _res, next) { if (!req.user) return next(new HttpError(401, 'Please sign in.', 'signed_out')); next(); }
function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.', 'signed_out'));
    if (req.user.role !== role) return next(new HttpError(403, `This needs a ${role} account.`, 'wrong_role'));
    next();
  };
}
function requireAdmin(req, _res, next) {
  if (req.adminSession) return next();
  if (!req.user) return next(new HttpError(401, 'Please sign in.', 'signed_out'));
  if (!req.user.isAdmin) return next(new HttpError(403, 'Admin access only.', 'not_admin'));
  next();
}

module.exports = { issueOtp, checkOtp, setSession, clearSession, loadUser, requireUser, requireRole, requireAdmin, isAdminPhone, adminLogin, clearAdmin, setActAs, clearActAs };
