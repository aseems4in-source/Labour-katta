'use strict';
// Phase 2 end-to-end test: availability, calendar, radius, blocks, search, favourites, teams, repeat booking,
// reminders, attendance register + overtime + finalising, ratings + disputes, reports, site notices, dashboard,
// automatic levels and builder verification. Run: npm test
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk2-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.ADMIN_PHONES = '9000000001';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT = '1000';
delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID;

const { createApp } = require('../src/app');
const { todayIST } = require('../src/util');
const { db } = require('../src/db');
const quality = require('../src/quality');
const scheduler = require('../src/scheduler');

function client(base) {
  const cookies = {};
  return async function call(method, url, body) {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    // Tick the terms like the app does, unless a test leaves them unticked on purpose (acceptTerms: false).
    if (method === 'POST' && /^\/api\/(contractor\/bookings|worker\/jobs\/[^/]+\/(accept|ask)|worker\/work\/[^/]+\/confirm)$/.test(url)) body = Object.assign({ acceptTerms: true }, body || {});
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) cookies[k] = v; else delete cookies[k]; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`${method} ${url} -> ${res.status} ${json.error}`); e.status = res.status; e.body = json; throw e; }
    return json;
  };
}
async function signup(call, phone, portal) {
  const otp = await call('POST', '/api/auth/request-otp', { phone });
  await call('POST', '/api/auth/verify-otp', { phone, portal, code: otp.devCode });
  return (await call('GET', '/api/me')).user.id;
}
async function pay(call, r) { if (r.payment) await call('POST', '/api/payments/test-complete', { paymentId: r.payment.paymentId }); return r; }
const outbox = (tpl) => db.prepare('SELECT * FROM notifications WHERE template = ? ORDER BY id').all(tpl);
const istAt = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`);
const setStart = (bookingId, date) => db.prepare('UPDATE bookings SET start_date = ? WHERE id = ?').run(date, bookingId);
const rejects = (p, code, msg) => assert.rejects(p, e => (e.body && e.body.code) === code || e.status === code, msg);

(async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const admin = client(base), con = client(base), A = client(base), B = client(base), C = client(base);
    await admin('POST', '/api/auth/admin-login', { username: 'admin', password: 'test-pass-123' });

    // ---- accounts: one builder (trial from admin) and three masons ----
    const cid = await signup(con, '9800000001', 'contractor');
    await con('POST', '/api/contractor/profile', { company: 'Om Constructions' });
    await admin('POST', `/api/admin/contractors/${cid}/trial`, { days: 60 });
    const ids = {};
    for (const [call, phone, name] of [[A, '9800000011', 'Anil Pawar'], [B, '9800000012', 'Bhavesh Rane'], [C, '9800000013', 'Chetan More']]) {
      ids[name] = await signup(call, phone, 'worker');
      await call('POST', '/api/worker/profile', { name, area: 'Thane', experience: name === 'Anil Pawar' ? '5+' : '1-3', skills: ['s01'] });
      await admin('POST', `/api/admin/workers/${ids[name]}/trial`, { days: 60 });
    }
    const aid = ids['Anil Pawar'], bid = ids['Bhavesh Rane'], ccid = ids['Chetan More'];
    const book = (extra) => con('POST', '/api/contractor/bookings', Object.assign({ lines: [{ skillId: 's01', count: 1 }], days: 2, level: 'any', payMode: 'direct', site: 'Om Residency', siteAddress: 'Kolshet Road, Thane', siteLat: 19.2183, siteLng: 72.9781, startDate: todayIST(1) }, extra || {})).then(r => pay(con, r));
    const avail = async (bkId) => (await con('GET', `/api/contractor/bookings/${bkId}/available-workers`)).workers.map(w => w.worker_id);

    // ---- 1. Available / Busy until / Unavailable ----
    const b1 = await book({ days: 1 });
    assert.deepStrictEqual((await avail(b1.bookingId)).sort(), [aid, bid, ccid].sort());
    await B('POST', '/api/worker/availability', { status: 'busy', busyUntil: todayIST(3) });
    assert.ok(!(await avail(b1.bookingId)).includes(bid), 'busy until after the start: not offered');
    assert.strictEqual((await B('GET', '/api/worker/jobs')).jobs.length, 0);
    await rejects(B('POST', '/api/worker/availability', { status: 'busy' }), 'bad_date', 'busy needs a date');
    await B('POST', '/api/worker/availability', { status: 'unavailable' });
    assert.strictEqual((await B('GET', '/api/me')).worker.avail_status, 'unavailable');
    await B('POST', '/api/worker/availability', { available: true }); // older app versions
    assert.ok((await avail(b1.bookingId)).includes(bid));
    console.log('  ✓ availability status');

    // ---- 2. calendar of days off ----
    await C('POST', '/api/worker/calendar', { date: todayIST(1), off: true });
    assert.deepStrictEqual((await C('GET', '/api/worker/calendar')).off, [todayIST(1)]);
    assert.ok(!(await avail(b1.bookingId)).includes(ccid), 'day off: not offered');
    await rejects(C('POST', '/api/worker/calendar', { date: '2020-01-01', off: true }), 'bad_date');
    await C('POST', '/api/worker/calendar', { dates: [todayIST(1)], off: false });
    assert.ok((await avail(b1.bookingId)).includes(ccid));
    console.log('  ✓ availability calendar');

    // ---- 3. travel radius ----
    await A('POST', '/api/worker/location', { lat: 19.076, lng: 72.8777, radiusKm: 5 }); // Mumbai, ~20 km from the site
    assert.ok(!(await avail(b1.bookingId)).includes(aid), 'outside travel radius');
    await A('POST', '/api/worker/location', { lat: 19.076, lng: 72.8777, radiusKm: 50 });
    const list1 = (await con('GET', `/api/contractor/bookings/${b1.bookingId}/available-workers`)).workers;
    const a1 = list1.find(w => w.worker_id === aid);
    assert.ok(a1.distanceKm > 15 && a1.distanceKm < 25, 'distance shown ' + a1.distanceKm);
    assert.ok(list1.every(w => typeof w.score === 'number' && w.reliability && w.rating), 'ranked with reasons');
    assert.ok(list1.every(w => !('phone' in w)), 'no phone numbers before assignment');
    await rejects(A('POST', '/api/worker/location', { lat: 19, lng: 72, radiusKm: 7 }), 400);
    console.log('  ✓ travel radius and smart ranking');

    // ---- 4. block ----
    await con('POST', '/api/blocks', { userId: ccid });
    assert.ok(!(await avail(b1.bookingId)).includes(ccid), 'blocked worker not offered');
    assert.ok(!(await C('GET', '/api/worker/jobs')).jobs.some(j => j.id === b1.bookingId), 'blocked builder hidden from worker');
    assert.strictEqual((await con('GET', '/api/blocks')).blocks[0].name, 'Chetan More');
    await rejects(con('POST', '/api/blocks', { userId: cid }), 404, 'cannot block yourself');
    await con('DELETE', `/api/blocks/${ccid}`);
    assert.ok((await avail(b1.bookingId)).includes(ccid));
    // worker can block a builder too
    await C('POST', '/api/blocks', { userId: cid });
    assert.ok(!(await avail(b1.bookingId)).includes(ccid));
    await C('DELETE', `/api/blocks/${cid}`);
    console.log('  ✓ block both ways');

    // ---- 5. search filters and favourites ----
    let found = (await con('GET', '/api/contractor/workers?skill=s01')).workers;
    assert.strictEqual(found.length, 3); assert.ok(found.every(w => !('phone' in w)));
    assert.strictEqual((await con('GET', '/api/contractor/workers?skill=s01&exp=3-5')).workers.length, 1, 'experience filter');
    assert.strictEqual((await con('GET', '/api/contractor/workers?skill=s01&area=pune')).workers.length, 0, 'area filter');
    assert.strictEqual((await con('GET', '/api/contractor/workers?skill=s01&maxWage=800')).workers.length, 0, 'wage filter (mason ₹900)');
    assert.strictEqual((await con('GET', `/api/contractor/workers?skill=s01&start=${todayIST(1)}&days=1`)).workers.length, 3, 'free on dates');
    await con('POST', '/api/contractor/favourites', { workerId: bid });
    found = (await con('GET', '/api/contractor/workers?skill=s01&fav=1')).workers;
    assert.deepStrictEqual(found.map(w => w.worker_id), [bid]); assert.strictEqual(found[0].favourite, true);
    console.log('  ✓ search filters and favourites');

    // ---- 6. repeat booking with preferred workers, saved team ----
    const b2 = await book({ preferWorkers: [bid], days: 1, startDate: todayIST(5) });
    let mine = (await con('GET', '/api/contractor/bookings')).bookings.find(x => x.id === b2.bookingId);
    assert.deepStrictEqual(mine.team.map(t => t.worker_id), [bid], 'preferred worker put on automatically');
    assert.ok(mine.team[0].favourite);
    const rep = await con('GET', `/api/contractor/bookings/${b2.bookingId}/repeat`);
    assert.deepStrictEqual(rep.preferWorkers, [bid]); assert.strictEqual(rep.siteAddress, 'Kolshet Road, Thane'); assert.deepStrictEqual(rep.lines, [{ skillId: 's01', count: 1 }]);
    await con('POST', '/api/contractor/teams', { name: 'Tower B masons', bookingId: b2.bookingId });
    const teams = (await con('GET', '/api/contractor/teams')).teams;
    assert.strictEqual(teams[0].members[0].worker_id, bid); assert.strictEqual(teams[0].members[0].skill_id, 's01');
    await con('DELETE', `/api/contractor/teams/${teams[0].id}`);
    console.log('  ✓ repeat booking, preferred workers, saved teams');

    // ---- 7. reminders the evening before, confirmation, alert to builder ----
    await con('POST', `/api/contractor/bookings/${b1.bookingId}/select`, { workerId: aid });
    const b3 = await book({ days: 1, reportTime: '08:30' });
    await con('POST', `/api/contractor/bookings/${b3.bookingId}/select`, { workerId: ccid });
    let r = await scheduler.runReminders(istAt(todayIST(), '16:00'));
    assert.strictEqual(r.reminded, 0, 'too early');
    r = await scheduler.runReminders(istAt(todayIST(), '18:30'));
    assert.strictEqual(r.reminded, 2); assert.strictEqual((await scheduler.runReminders(istAt(todayIST(), '19:00'))).reminded, 0, 'sent once');
    assert.ok(outbox('jobReminder').some(n => /08:30/.test(n.body)), 'reporting time in reminder');
    await A('POST', `/api/worker/work/${b1.bookingId}/confirm`);
    assert.ok((await A('GET', '/api/worker/work')).work.find(x => x.id === b1.bookingId).confirmed_at);
    r = await scheduler.runReminders(istAt(todayIST(1), '06:00'));
    assert.strictEqual(r.notConfirmed, 0, 'before the deadline (08:30 − 2 h)');
    r = await scheduler.runReminders(istAt(todayIST(1), '06:35'));
    assert.strictEqual(r.notConfirmed, 1, 'only the worker who did not confirm');
    assert.ok(outbox('notConfirmed')[0].body.includes('Chetan More'));
    assert.strictEqual((await con('GET', '/api/contractor/dashboard')).unconfirmed, 1);
    console.log('  ✓ reminders, confirmations, builder alert');

    // ---- 8. urgent site notice ----
    const sent = await con('POST', `/api/contractor/bookings/${b1.bookingId}/notice`, { text: 'Site closed tomorrow due to heavy rain.' });
    assert.strictEqual(sent.sentTo, 1); assert.ok(outbox('siteNotice')[0].body.includes('heavy rain'));
    for (let i = 0; i < 4; i++) await con('POST', `/api/contractor/bookings/${b1.bookingId}/notice`, { text: 'Update ' + i });
    await rejects(con('POST', `/api/contractor/bookings/${b1.bookingId}/notice`, { text: 'one more' }), 429, 'notice limit');
    console.log('  ✓ urgent site notice');

    // ---- 9. attendance register: past days, overtime, agreed rate, finalise ----
    setStart(b1.bookingId, todayIST(-1));
    db.prepare('UPDATE bookings SET days = 2 WHERE id = ?').run(b1.bookingId);
    await con('POST', `/api/contractor/bookings/${b1.bookingId}/attendance`, { workerId: aid, status: 'late', date: todayIST(-1) });
    await con('POST', `/api/contractor/bookings/${b1.bookingId}/attendance`, { workerId: aid, status: 'present', otHours: 2 });
    await rejects(con('POST', `/api/contractor/bookings/${b1.bookingId}/attendance`, { workerId: aid, status: 'present', date: todayIST(1) }), 'bad_date', 'no future days');
    await rejects(con('POST', `/api/contractor/bookings/${b1.bookingId}/attendance`, { workerId: aid, status: 'present', otHours: 13 }), 400);
    let reg = await con('GET', `/api/contractor/bookings/${b1.bookingId}/register`);
    assert.deepStrictEqual(reg.dates, [todayIST(-1), todayIST(0)]);
    let pay1 = reg.team[0].pay;
    assert.strictEqual(pay1.payDays, 2); assert.strictEqual(pay1.otHours, 2);
    assert.strictEqual(pay1.otRate, Math.round(900 / 8 * 2), 'default overtime = wage/8 × 2');
    await con('PATCH', `/api/contractor/bookings/${b1.bookingId}/terms`, { otRate: 300, reportTime: '08:00' });
    pay1 = (await con('GET', `/api/contractor/bookings/${b1.bookingId}/register`)).team[0].pay;
    assert.strictEqual(pay1.earned, 2 * 900 + 2 * 300, 'wages from attendance + agreed overtime');
    const fin = await con('POST', `/api/contractor/bookings/${b1.bookingId}/finalise`, { workerId: aid });
    assert.strictEqual(fin.amount, 2400);
    await rejects(con('POST', `/api/contractor/bookings/${b1.bookingId}/attendance`, { workerId: aid, status: 'absent' }), 'wages_final', 'locked after finalising');
    assert.ok(outbox('wagesFinal')[0].body.includes('₹2,400'));
    const wk = (await A('GET', '/api/worker/work')).work.find(x => x.id === b1.bookingId);
    assert.strictEqual(wk.pay.finalAmount, 2400); assert.strictEqual(wk.register.length, 2);
    console.log('  ✓ attendance corrections, overtime, wage finalising');

    // ---- 10. dashboard / today's site summary ----
    await A('POST', `/api/worker/work/${b2.bookingId}/confirm`).catch(() => {});
    let dash = await con('GET', '/api/contractor/dashboard');
    assert.strictEqual(dash.attendance.expected, 1); assert.strictEqual(dash.attendance.present, 1);
    assert.strictEqual(dash.sites[0].site, 'Om Residency');
    assert.ok(dash.upcoming.some(u => u.id === b2.bookingId), 'upcoming within 7 days');
    assert.strictEqual(dash.wagesOutstanding, 2400, 'direct-pay wages not yet confirmed by the worker');
    console.log('  ✓ builder dashboard and site summary');

    // ---- 11. ratings after the job, worker dispute, admin decision ----
    const b4 = await book({ days: 1, startDate: todayIST(2) });
    await con('POST', `/api/contractor/bookings/${b4.bookingId}/select`, { workerId: bid });
    await rejects(con('POST', `/api/contractor/bookings/${b4.bookingId}/rate`, { workerId: bid, stars: 5 }), 'not_finished', 'only after the job');
    setStart(b4.bookingId, todayIST(-3));
    await rejects(con('POST', `/api/contractor/bookings/${b4.bookingId}/rate`, { workerId: bid, stars: 6 }), 400);
    await con('POST', `/api/contractor/bookings/${b4.bookingId}/rate`, { workerId: bid, stars: 2, comment: 'Came late' });
    assert.deepStrictEqual(quality.ratingOf(bid), { avg: 2, count: 1 });
    let wr = await B('GET', '/api/worker/ratings');
    assert.strictEqual(wr.ratings[0].stars, 2); assert.strictEqual(wr.ratings[0].company, 'Om Constructions');
    await B('POST', `/api/worker/ratings/${b4.bookingId}/dispute`, { text: 'I was on time, the gate was locked.' });
    await rejects(B('POST', `/api/worker/ratings/${b4.bookingId}/dispute`, { text: 'again please' }), 'already_disputed');
    await rejects(con('POST', `/api/contractor/bookings/${b4.bookingId}/rate`, { workerId: bid, stars: 1 }), 'disputed', 'frozen while disputed');
    let reps = (await admin('GET', '/api/admin/reports')).reports;
    const rr = reps.find(x => x.kind === 'rating');
    assert.ok(rr && rr.rating.stars === 2 && rr.from_name === 'Bhavesh Rane');
    await admin('POST', `/api/admin/reports/${rr.id}/resolve`, { resolution: 'Gate log shows he arrived on time.', ratingAction: 'remove' });
    assert.deepStrictEqual(quality.ratingOf(bid), { avg: null, count: 0 }, 'removed rating no longer counts');
    console.log('  ✓ ratings, disputes, admin decision');

    // ---- 12. payment dispute and urgent incident ----
    await A('POST', '/api/reports', { kind: 'payment', category: 'payment', bookingId: b1.bookingId, text: 'Overtime of 2 hours not paid.' });
    await rejects(B('POST', '/api/reports', { kind: 'payment', category: 'payment', bookingId: b1.bookingId, text: 'not my booking' }), 404);
    const inc = await C('POST', '/api/reports', { kind: 'incident', category: 'accident', bookingId: b3.bookingId, text: 'Worker fell from scaffolding, taken to hospital.' });
    assert.strictEqual(inc.urgent, true);
    assert.ok(outbox('urgentReport').some(n => n.phone === '9000000001'), 'admin alerted on WhatsApp');
    assert.strictEqual((await C('GET', '/api/reports/mine')).reports[0].status, 'open');
    const ov = await admin('GET', '/api/admin/overview');
    assert.ok(ov.urgentReports >= 1 && ov.openReports >= 2); assert.ok(ov.today.expected >= 1);
    reps = (await admin('GET', '/api/admin/reports')).reports;
    assert.ok(reps[0].urgent, 'urgent reports first');
    console.log('  ✓ payment disputes and urgent incidents');

    // ---- 13. supervisors need the disputes permission ----
    const g = await admin('POST', '/api/admin/staff/groups', { name: 'Sites', perms: ['bookings'] });
    await admin('POST', '/api/admin/staff/users', { name: 'Ravi', username: 'ravi', password: 'ravi-pass-1', group_id: g.id });
    const sup = client(base); await sup('POST', '/api/auth/admin-login', { username: 'ravi', password: 'ravi-pass-1' });
    await rejects(sup('GET', '/api/admin/reports'), 403);
    await admin('PATCH', `/api/admin/staff/groups/${g.id}`, { perms: ['bookings', 'disputes'] });
    assert.ok((await sup('GET', '/api/admin/reports')).reports.length >= 3);
    await sup('POST', `/api/admin/bookings/${b3.bookingId}/notice`, { text: 'Safety briefing at 8 am.' });
    console.log('  ✓ supervisor permissions for disputes and notices');

    // ---- 14. builder verification shown to workers ----
    assert.strictEqual((await A('GET', '/api/worker/work')).work[0].builder.verified, 0);
    await admin('PATCH', `/api/admin/contractors/${cid}`, { verified_id: true, verified_gst: true });
    assert.strictEqual((await A('GET', '/api/worker/work')).work[0].builder.verified, 1);
    assert.strictEqual((await con('GET', '/api/me')).contractor.vflags.verified, 1);
    console.log('  ✓ builder verification');

    // ---- 15. automatic levels ----
    assert.strictEqual((await A('GET', '/api/me')).worker.tier, 'bronze');
    await admin('PATCH', `/api/admin/workers/${aid}`, { verified_aadhaar: true, verified_photo: true });
    assert.strictEqual((await A('GET', '/api/me')).worker.tier, 'silver', 'ID + photo + profile = Silver');
    await admin('PATCH', `/api/admin/workers/${aid}`, { verified_test: true });
    assert.strictEqual((await A('GET', '/api/me')).worker.tier, 'silver', 'skill test alone is not Gold');
    assert.ok((await A('GET', '/api/me')).worker.nextLevel.includes('jobs'));
    // five completed jobs with good attendance
    const tpl = db.prepare('SELECT * FROM bookings WHERE id = ?').get(b1.bookingId);
    for (let i = 0; i < 5; i++) {
      const row = Object.assign({}, tpl, { id: 'bk_past' + i, group_id: 'ord_past' + i, start_date: todayIST(-20 - i * 3), days: 1, status: 'assigned' });
      const cols = Object.keys(row);
      db.prepare(`INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
      db.prepare("INSERT INTO assignments (booking_id, worker_id, status, assigned_at) VALUES (?, ?, 'active', ?)").run(row.id, aid, new Date().toISOString());
      db.prepare("INSERT INTO attendance (booking_id, worker_id, date, status, marked_at) VALUES (?, ?, ?, 'present', ?)").run(row.id, aid, row.start_date, new Date().toISOString());
    }
    assert.strictEqual(quality.recomputeTier(aid), 'gold', 'earned Gold');
    const rel = quality.reliability(aid);
    assert.ok(rel.jobsDone >= 5 && rel.score >= 85, JSON.stringify(rel));
    await admin('PATCH', `/api/admin/workers/${aid}`, { tier_cap: 'silver' });
    assert.strictEqual((await A('GET', '/api/me')).worker.tier, 'silver', 'admin can cap lower');
    await admin('PATCH', `/api/admin/workers/${aid}`, { tier_cap: 'gold' });
    assert.strictEqual((await A('GET', '/api/me')).worker.tier, 'gold');
    const aw = (await admin('GET', '/api/admin/workers')).workers.find(w => w.user_id === aid);
    assert.strictEqual(aw.computedTier, 'gold'); assert.ok(aw.reliability.score >= 85);
    // a declined job counts against reliability
    assert.strictEqual(quality.reliability(bid).cancellations, 0);
    await B('POST', `/api/worker/work/${b2.bookingId}/decline`);
    assert.strictEqual(quality.reliability(bid).cancellations, 1);
    console.log('  ✓ automatic levels and reliability');

    const n = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
    console.log('✔ phase 2 test passed —', n, 'WhatsApp messages queued in test mode');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error('✘ phase 2 test failed:', e.message, e.body || '', (e.stack || '').split('\n').find(l => l.includes('phase2.test'))); process.exit(1); });
