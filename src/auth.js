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

function checkOtp(phone, code, keep) {
  const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'This code has expired. Ask for a new one.', 'otp_expired');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.', 'otp_locked');
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashCode(phone, String(code || '').trim())));
  if (!ok) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    throw new HttpError(400, 'That code is not right. Check the WhatsApp message and try again.', 'otp_wrong');
  }
  // keep: the code was right but the number is not registered yet, so the same code can be used to sign up.
  if (!keep) db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
}

// ---- admin and supervisor (staff) username/password login ----
const ADMIN_COOKIE = 'lk_admin';
const ACT_COOKIE = 'lk_actas';
// What a supervisor group can be allowed to do. The main admin can do everything, including managing staff.
const PERMS = {
  bookings: 'See all bookings and assign supervisors',
  workers: 'Add, edit and delete workers; verify, tiers, trials, cash',
  builders: 'Add, edit and delete builders; trials and special prices',
  pricing: 'Change prices, fees and skills',
  coupons: 'Create and manage coupon codes',
  payments: 'See payments and WhatsApp messages',
  open_portals: 'Open a worker or builder portal',
  disputes: 'Handle reports, disputes and reviews; verify builders',
  projects: 'Projects marketplace: contractors/professionals, categories, projects and inspections',
};
const ALL_PERMS = Object.keys(PERMS);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32);
  return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex');
}
function verifyPassword(pw, stored) {
  const [kind, saltHex, keyHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const adminFails = new Map(); // ip -> { n, until }
function adminLogin(req, res, username, password) {
  const ip = req.ip || 'x';
  const f = adminFails.get(ip);
  if (f && f.until > Date.now()) throw new HttpError(429, 'Too many wrong attempts. Try again in 15 minutes.', 'admin_locked');
  const digest = (v) => crypto.createHash('sha256').update(String(v || '')).digest();
  let claim = null;
  // Username is not case-sensitive (Admin = admin); password is, after trimming spaces.
  const pw = String(password || '').trim();
  if (config.adminPassword && crypto.timingSafeEqual(digest(String(username || '').toLowerCase()), digest(config.adminUsername.toLowerCase()))) {
    if (crypto.timingSafeEqual(digest(pw), digest(config.adminPassword))) claim = { adm: 'root' };
  } else {
    const st = db.prepare('SELECT * FROM staff_users WHERE username = ? COLLATE NOCASE AND active = 1').get(String(username || ''));
    if (st && (verifyPassword(password, st.pass_hash) || verifyPassword(pw, st.pass_hash))) claim = { adm: 'staff', sid: st.id };
  }
  if (!claim) {
    const n = (f && f.until <= Date.now() ? 0 : (f ? f.n : 0)) + 1;
    adminFails.set(ip, { n, until: n >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
    if (!config.adminPassword && !db.prepare('SELECT 1 FROM staff_users LIMIT 1').get()) throw new HttpError(503, 'Admin login is not set up on the server.', 'admin_disabled');
    throw new HttpError(401, 'Wrong username or password.', 'admin_wrong');
  }
  adminFails.delete(ip);
  const token = jwt.sign(claim, config.jwtSecret, { expiresIn: '12h' });
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 12 * 3600 * 1000, path: '/' });
}
function clearAdmin(res) { res.clearCookie(ADMIN_COOKIE, { path: '/' }); res.clearCookie(ACT_COOKIE, { path: '/' }); }
// Admin opens a worker or builder portal as that account.
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
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(uid);
      if (user) { user.isAdmin = isAdminPhone(user.phone); req.user = user; }
    } catch (_) { /* expired or tampered cookie: treat as signed out */ }
  }
  // req.admin = { root, staffId, name, perms } for the main admin or a supervisor
  const adm = req.cookies && req.cookies[ADMIN_COOKIE];
  if (adm) {
    try {
      const c = jwt.verify(adm, config.jwtSecret);
      if (c.adm === 'root' && config.adminPassword) req.admin = { root: true, staffId: null, name: 'Admin', perms: ALL_PERMS };
      if (c.adm === 'staff') {
        const st = db.prepare('SELECT s.*, g.perms AS gperms, g.name AS gname FROM staff_users s LEFT JOIN staff_groups g ON g.id = s.group_id WHERE s.id = ? AND s.active = 1').get(c.sid);
        if (st) {
          let perms = []; try { perms = JSON.parse(st.gperms || '[]').filter(p => ALL_PERMS.includes(p)); } catch (_) { perms = []; }
          req.admin = { root: false, staffId: st.id, name: st.name, group: st.gname || '', perms };
        }
      }
    } catch (_) { /* expired */ }
  }
  if (!req.admin && req.user && req.user.isAdmin) req.admin = { root: true, staffId: null, name: 'Admin', perms: ALL_PERMS };
  req.adminSession = Boolean(req.admin);
  const act = req.cookies && req.cookies[ACT_COOKIE];
  if (act && req.admin && req.admin.perms.includes('open_portals')) {
    try {
      const { uid } = jwt.verify(act, config.jwtSecret);
      const target = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(uid);
      if (target) { target.isAdmin = true; target.actingAs = true; req.user = target; }
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
  if (req.admin) return next();
  if (!req.user) return next(new HttpError(401, 'Please sign in.', 'signed_out'));
  next(new HttpError(403, 'Admin access only.', 'not_admin'));
}
function requirePerm(perm) {
  return (req, _res, next) => {
    if (!req.admin) return next(new HttpError(401, 'Please sign in.', 'signed_out'));
    if (req.admin.root || req.admin.perms.includes(perm)) return next();
    next(new HttpError(403, 'You do not have permission for this.', 'no_permission'));
  };
}
function requireRoot(req, _res, next) {
  if (!req.admin) return next(new HttpError(401, 'Please sign in.', 'signed_out'));
  if (!req.admin.root) return next(new HttpError(403, 'Only the main admin can do this.', 'not_root'));
  next();
}

module.exports = { issueOtp, checkOtp, setSession, clearSession, loadUser, requireUser, requireRole, requireAdmin, isAdminPhone, adminLogin, clearAdmin, setActAs, clearActAs,
  requirePerm, requireRoot, hashPassword, verifyPassword, PERMS, ALL_PERMS };
