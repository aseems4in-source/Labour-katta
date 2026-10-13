'use strict';
// Automatic reminders (runs every 5 minutes):
//  1. The evening before a job (from the admin's reminder hour, IST), each worker gets the site, date, reporting time
//     and address, and is asked to confirm in the app. Workers assigned later still get it before the job starts.
//  2. If a worker has not confirmed by (reporting time − confirm_hours_before) on the first day, the builder is told,
//     so they can replace the worker.
// Each message is sent once (reminders table). Also refreshes automatic worker levels every hour.
const { db, getSettings } = require('./db');
const { nowIso, formatDate } = require('./util');
const wa = require('./services/whatsapp');
const quality = require('./quality');
const domain = require('./domain');

function ist(now) {
  const d = new Date(now.getTime() + 330 * 60000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toMin = (hhmm) => { const [h, m] = String(hhmm || '09:00').split(':').map(Number); return h * 60 + (m || 0); };
const sent = (bid, wid, kind) => Boolean(db.prepare('SELECT 1 FROM reminders WHERE booking_id = ? AND worker_id = ? AND kind = ?').get(bid, wid, kind));
const mark = (bid, wid, kind) => db.prepare('INSERT OR IGNORE INTO reminders (booking_id, worker_id, kind, sent_at) VALUES (?, ?, ?, ?)').run(bid, wid, kind, nowIso());

async function runReminders(now = new Date()) {
  const s = getSettings();
  const { date: today, minutes } = ist(now);
  const tomorrow = addDays(today, 1);
  const out = { reminded: 0, notConfirmed: 0 };
  const rows = db.prepare(`SELECT a.booking_id, a.worker_id, a.confirmed_at, b.*, w.name AS worker_name, u.phone AS worker_phone, u.lang AS worker_lang
    FROM assignments a JOIN bookings b ON b.id = a.booking_id JOIN workers w ON w.user_id = a.worker_id JOIN users u ON u.id = a.worker_id
    WHERE a.status = 'active' AND b.status IN ('open','assigned') AND b.start_date IN (?, ?) AND u.deleted_at IS NULL`).all(today, tomorrow);
  for (const r of rows) {
    const report = toMin(r.report_time);
    const dueEvening = (r.start_date === tomorrow && minutes >= (s.reminder_hour || 18) * 60) || (r.start_date === today && minutes < report);
    if (dueEvening && !r.confirmed_at && !sent(r.booking_id, r.worker_id, 'eve')) {
      mark(r.booking_id, r.worker_id, 'eve');
      await wa.sendTemplate({ userId: r.worker_id, phone: r.worker_phone, lang: r.worker_lang, templateKey: 'jobReminder',
        params: { site: r.site, date: formatDate(r.start_date), time: r.report_time, address: r.site_address || r.site } });
      out.reminded++;
    }
    const deadline = report - (s.confirm_hours_before == null ? 2 : s.confirm_hours_before) * 60;
    if (r.start_date === today && minutes >= deadline && !r.confirmed_at && !sent(r.booking_id, r.worker_id, 'nc')) {
      mark(r.booking_id, r.worker_id, 'nc');
      const c = domain.getContractor(r.contractor_id);
      if (domain.contractorPlanActive(c)) await wa.sendTemplate({ userId: c.user_id, phone: c.phone, lang: c.lang, templateKey: 'notConfirmed',
        params: { name: r.worker_name, site: r.site, time: r.report_time } });
      out.notConfirmed++;
    }
  }
  return out;
}

let lastTiers = 0;
function start() {
  const tick = () => {
    runReminders().catch(e => console.error('[reminders]', e.message));
    if (Date.now() - lastTiers > 3600 * 1000) { lastTiers = Date.now(); try { quality.recomputeAllTiers(); } catch (e) { console.error('[tiers]', e.message); } }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 5 * 60 * 1000);
}

module.exports = { runReminders, start, ist };
