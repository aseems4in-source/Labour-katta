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
  if (!req.user) return next(new HttpError(401, 'Please sign in.', 'signed_out'));
  if (!req.user.isAdmin) return next(new HttpError(403, 'Admin access only.', 'not_admin'));
  next();
}

module.exports = { issueOtp, checkOtp, setSession, clearSession, loadUser, requireUser, requireRole, requireAdmin, isAdminPhone };
