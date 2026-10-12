'use strict';
const crypto = require('crypto');

const id = (prefix) => prefix + '_' + crypto.randomBytes(9).toString('base64url');
const nowIso = () => new Date().toISOString();

// Today's date in India (YYYY-MM-DD), regardless of server timezone.
function todayIST(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Accepts 10-digit Indian mobile numbers with or without +91 / 0 prefix.
function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'error'; }
}
const bad = (msg, code) => new HttpError(400, msg, code || 'bad_request');

function int(v, { min = 0, max = Number.MAX_SAFE_INTEGER, name = 'value' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`);
  return n;
}
function str(v, { max = 200, name = 'value', required = true } = {}) {
  const s = String(v == null ? '' : v).trim();
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} must be at most ${max} characters.`);
  return s;
}

module.exports = { id, nowIso, todayIST, normalizePhone, formatDate, rupees, HttpError, bad, int, str };
