'use strict';
const express = require('express');
const config = require('../config');
const { db, getSettings, DEFAULT_SETTINGS } = require('../db');
const { id, nowIso, bad, str, int, HttpError } = require('../util');
const auth = require('../auth');
const domain = require('../domain');

const r = require('../router')();
r.use(auth.requireAdmin);

r.get('/overview', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  res.json({
    workers: one('SELECT COUNT(*) AS n FROM workers'),
    activeMembers: one("SELECT COUNT(*) AS n FROM workers WHERE membership_status = 'active'"),
    pendingCash: one("SELECT COUNT(*) AS n FROM workers WHERE membership_status = 'pending_cash'"),
    contractors: one('SELECT COUNT(*) AS n FROM contractors'),
    activePlans: one("SELECT COUNT(*) AS n FROM contractors WHERE plan_status = 'active'"),
    openBookings: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'open'"),
    paidTotal: db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE status = 'paid' AND test = 0").get().n,
    integrations: { payments: config.razorpay.live ? 'live' : 'test', whatsapp: config.whatsapp.live ? 'live' : 'test', webhookSecret: Boolean(config.razorpay.webhookSecret) },
  });
});

r.get('/settings', (req, res) => res.json({ settings: getSettings() }));
r.put('/settings', (req, res) => {
  const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  db.transaction(() => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (req.body[key] === undefined) continue;
      const max = key === 'worker_membership_required' ? 1 : 1000000;
      up.run(String(int(req.body[key], { min: 0, max, name: key })), key);
    }
  })();
  res.json({ settings: getSettings() });
});

r.get('/skills', (req, res) => res.json({ skills: db.prepare('SELECT * FROM skills WHERE active = 1 ORDER BY cat, en').all() }));
r.post('/skills', (req, res) => {
  const row = {
    id: id('sk'), en: str(req.body.en, { name: 'English name', max: 60 }), hi: str(req.body.hi, { name: 'Hindi name', max: 60, required: false }),
    mr: str(req.body.mr, { name: 'Marathi name', max: 60, required: false }), cat: req.body.cat === 'unskilled' ? 'unskilled' : 'skilled',
    wage: int(req.body.wage, { min: 1, max: 100000, name: 'Wage' }), created_at: nowIso(),
  };
  db.prepare('INSERT INTO skills (id, en, hi, mr, cat, wage, created_at) VALUES (@id, @en, @hi, @mr, @cat, @wage, @created_at)').run(row);
  res.json({ skill: row });
});
r.patch('/skills/:id', (req, res) => {
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
r.delete('/skills/:id', (req, res) => {
  db.prepare('UPDATE skills SET active = 0 WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM worker_skills WHERE skill_id = ?').run(req.params.id);
  res.json({ ok: true });
});

r.get('/workers', (req, res) => {
  const rows = db.prepare('SELECT w.*, u.phone FROM workers w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 1000').all();
  const skills = db.prepare('SELECT skill_id FROM worker_skills WHERE worker_id = ?');
  res.json({ workers: rows.map(w => Object.assign(w, { skills: skills.all(w.user_id).map(s => s.skill_id) })) });
});
r.patch('/workers/:id', (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w) throw new HttpError(404, 'Worker not found.', 'not_found');
  const sets = [], vals = [];
  if (req.body.tier !== undefined) { if (!['bronze', 'silver', 'gold'].includes(req.body.tier)) throw bad('Unknown tier.'); sets.push('tier = ?'); vals.push(req.body.tier); }
  if (req.body.custom_wage !== undefined) { sets.push('custom_wage = ?'); vals.push(req.body.custom_wage === null || req.body.custom_wage === '' ? null : int(req.body.custom_wage, { min: 1, max: 100000, name: 'Custom wage' })); }
  for (const k of ['verified_aadhaar', 'verified_photo', 'verified_bank', 'verified_test']) {
    if (req.body[k] !== undefined) { sets.push(`${k} = ?`); vals.push(req.body[k] ? 1 : 0); }
  }
  if (sets.length) db.prepare(`UPDATE workers SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, w.user_id);
  res.json({ ok: true });
});
r.post('/workers/:id/cash-received', async (req, res) => {
  const w = domain.getWorker(req.params.id);
  if (!w) throw new HttpError(404, 'Worker not found.', 'not_found');
  const amount = getSettings().worker_cash_monthly;
  db.prepare(`INSERT INTO payments (id, user_id, kind, ref_id, amount, status, test, created_at, updated_at)
    VALUES (?, ?, 'worker_membership', ?, ?, 'paid', 0, ?, ?)`).run(id('pay'), w.user_id, w.user_id, amount, nowIso(), nowIso());
  await domain.activateWorkerMembership(w.user_id, 'cash', null);
  res.json({ ok: true });
});

r.get('/contractors', (req, res) => res.json({ contractors: db.prepare('SELECT c.*, u.phone FROM contractors c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC LIMIT 1000').all() }));
r.get('/bookings', (req, res) => {
  const rows = db.prepare('SELECT b.*, c.company FROM bookings b JOIN contractors c ON c.user_id = b.contractor_id ORDER BY b.created_at DESC LIMIT 500').all();
  res.json({ bookings: rows.map(b => Object.assign(b, { assigned: domain.activeCount(b.id) })) });
});
r.get('/payments', (req, res) => res.json({ payments: db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 500').all() }));
r.get('/notifications', (req, res) => res.json({ notifications: db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 300').all() }));

module.exports = r;
