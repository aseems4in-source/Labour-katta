'use strict';
// Reports and disputes: payment disputes, rating disputes, problems (misconduct, unsafe site, fraud) and incidents.
// Urgent reports and accidents are sent to the admin phones (and the site's supervisor) on WhatsApp straight away.
const config = require('./config');
const { db } = require('./db');
const { id, nowIso, bad } = require('./util');
const wa = require('./services/whatsapp');

const KINDS = ['payment', 'problem', 'incident', 'rating'];
const CATEGORIES = ['payment', 'misconduct', 'unsafe', 'fraud', 'accident', 'other', 'rating'];

function nameOf(userId) {
  const r = db.prepare(`SELECT u.phone, w.name, c.company FROM users u LEFT JOIN workers w ON w.user_id = u.id LEFT JOIN contractors c ON c.user_id = u.id WHERE u.id = ?`).get(userId);
  return r ? (r.name || r.company || r.phone) : 'Unknown';
}

async function createReport({ kind, category, urgent, bookingId, fromUser, againstUser, text }) {
  if (!KINDS.includes(kind)) throw bad('Choose what you are reporting.');
  if (!CATEGORIES.includes(category)) throw bad('Choose a category.');
  const body = String(text || '').trim();
  if (body.length < 5) throw bad('Please describe the problem in a few words.');
  if (body.length > 1000) throw bad('Please keep it under 1000 characters.');
  const isUrgent = Boolean(urgent) || category === 'accident';
  const row = { id: id('rp'), kind, category, urgent: isUrgent ? 1 : 0, booking_id: bookingId || null, from_user: fromUser, against_user: againstUser || null, text: body, created_at: nowIso() };
  db.prepare(`INSERT INTO reports (id, kind, category, urgent, booking_id, from_user, against_user, text, created_at)
    VALUES (@id, @kind, @category, @urgent, @booking_id, @from_user, @against_user, @text, @created_at)`).run(row);
  if (isUrgent) {
    const phones = new Set(config.adminPhones);
    if (bookingId) {
      const sup = db.prepare('SELECT s.phone FROM bookings b JOIN staff_users s ON s.id = b.supervisor_id WHERE b.id = ? AND s.active = 1').get(bookingId);
      if (sup && sup.phone) phones.add(sup.phone);
    }
    const site = bookingId ? (db.prepare('SELECT site FROM bookings WHERE id = ?').get(bookingId) || {}).site || '' : '';
    for (const phone of phones) {
      await wa.sendTemplate({ userId: null, phone, lang: 'en', templateKey: 'urgentReport',
        params: { category, from: nameOf(fromUser) + (site ? ' · ' + site : ''), text: body.slice(0, 300) } });
    }
  }
  return row;
}

function listReports(where, ...args) {
  return db.prepare(`SELECT r.*, b.site, b.group_id FROM reports r LEFT JOIN bookings b ON b.id = r.booking_id ${where} ORDER BY r.status = 'open' DESC, r.urgent DESC, r.created_at DESC LIMIT 500`).all(...args)
    .map(r => Object.assign(r, { from_name: nameOf(r.from_user), against_name: r.against_user ? nameOf(r.against_user) : '' }));
}

module.exports = { createReport, listReports, nameOf, KINDS, CATEGORIES };
