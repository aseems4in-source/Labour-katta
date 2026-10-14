'use strict';
// Phase 3 test: ask for more money, travel money, automatic replacement, terms. Was: Phase 2 end-to-end test: availability, calendar, radius, blocks, search, favourites, teams, repeat booking,
// reminders, attendance register + overtime + finalising, ratings + disputes, reports, site notices, dashboard,
// automatic levels and builder verification. Run: npm test
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3-'));
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
    await admin('POST', '/api/auth/admin-login', { username: 'ADMIN', password: ' test-pass-123 ' });
    const cid = await signup(con, '9700000001', 'contractor');
    await con('POST', '/api/contractor/profile', { company: 'Sai Builders' });
    await admin('POST', `/api/admin/contractors/${cid}/trial`, { days: 60 });
    const ids = {};
    for (const [call, phone, name] of [[A, '9700000011', 'Anil'], [B, '9700000012', 'Bhavesh'], [C, '9700000013', 'Chetan']]) {
      ids[name] = await signup(call, phone, 'worker');
      await call('POST', '/api/worker/profile', { name, area: 'Thane', skills: ['s01'] });
      await admin('POST', `/api/admin/workers/${ids[name]}/trial`, { days: 60 });
    }
    const base1 = { lines: [{ skillId: 's01', count: 1 }], days: 2, payMode: 'lk', site: 'Sai Park', startDate: todayIST(2) };

    // ---- terms must be ticked ----
    await rejects(con('POST', '/api/contractor/bookings', Object.assign({}, base1, { acceptTerms: false })), 'terms_required', 'builder must tick terms');
    // ---- travel money is a separate line, included in the total ----
    // Mason 900 + margin 150 = 1050 × 1 × 2 = 2100; travel 100 × 1 × 2 = 200; platform fee 20; no job fee on plan
    const bk = await con('POST', '/api/contractor/bookings', Object.assign({}, base1, { travelPerDay: 100, otRate: 200 }));
    assert.strictEqual(bk.payment.amount, 2320, 'travel money charged separately');
    await pay(con, bk);
    let job = (await A('GET', '/api/worker/jobs')).jobs.find(j => j.id === bk.bookingId);
    assert.strictEqual(job.travel_per_day, 100);
    await rejects(A('POST', `/api/worker/jobs/${bk.bookingId}/accept`, { acceptTerms: false }), 'terms_required', 'worker must tick terms');
    console.log('  ✓ terms required, travel money in the price');

    // ---- ask for more money ----
    await rejects(A('POST', `/api/worker/jobs/${bk.bookingId}/ask`, { wage: 800 }), 'bad_amount', 'less than offered');
    await rejects(A('POST', `/api/worker/jobs/${bk.bookingId}/ask`, { wage: 900, travel: 100 }), 'bad_amount', 'nothing more asked');
    await rejects(A('POST', `/api/worker/jobs/${bk.bookingId}/ask`, { wage: 5000 }), 'bad_amount', 'over 3× is refused');
    await A('POST', `/api/worker/jobs/${bk.bookingId}/ask`, { wage: 1100, travel: 150, note: 'Coming from Kalyan' });
    await rejects(A('POST', `/api/worker/jobs/${bk.bookingId}/ask`, { wage: 1200 }), 'already_asked');
    assert.ok(outbox('counterOffer')[0].body.includes('₹1,100'), 'builder told on WhatsApp');
    job = (await A('GET', '/api/worker/jobs')).jobs.find(j => j.id === bk.bookingId);
    assert.strictEqual(job.myAsk.status, 'pending');
    await B('POST', `/api/worker/jobs/${bk.bookingId}/ask`, { wage: 1000 });
    let mine = (await con('GET', '/api/contractor/bookings')).bookings.find(b => b.id === bk.bookingId);
    assert.strictEqual(mine.asks.length, 2); assert.strictEqual(mine.asks[0].askWage, 1100); assert.strictEqual(mine.asks[0].askNote, 'Coming from Kalyan');
    assert.ok(!('phone' in mine.asks[0]));
    // builder says no to Bhavesh: he is told and can still take the job at the normal wage
    await con('POST', `/api/contractor/counters/${mine.asks[1].askId}/decline`);
    assert.ok(outbox('counterDeclined')[0].body.includes('₹900'));
    assert.strictEqual((await B('GET', '/api/worker/jobs')).jobs.find(j => j.id === bk.bookingId).myAsk.status, 'declined');
    // builder says yes to Anil: booked at the agreed amounts
    await con('POST', `/api/contractor/counters/${mine.asks[0].askId}/accept`);
    await rejects(con('POST', `/api/contractor/counters/${mine.asks[0].askId}/accept`), 'not_pending');
    mine = (await con('GET', '/api/contractor/bookings')).bookings.find(b => b.id === bk.bookingId);
    assert.strictEqual(mine.status, 'assigned'); assert.strictEqual(mine.team[0].name, 'Anil');
    const aw = (await A('GET', '/api/worker/work')).work.find(x => x.id === bk.bookingId);
    assert.strictEqual(aw.wage, 1100); assert.strictEqual(aw.travel, 150); assert.ok(aw.agreed && aw.terms_ok);
    console.log('  ✓ ask for more: builder accepts or declines');

    // ---- wages + overtime (additional hourly charges) + travel from attendance ----
    db.prepare('UPDATE bookings SET start_date = ? WHERE id = ?').run(todayIST(0), bk.bookingId);
    await con('POST', `/api/contractor/bookings/${bk.bookingId}/attendance`, { workerId: ids.Anil, status: 'present', otHours: 2 });
    const reg = await con('GET', `/api/contractor/bookings/${bk.bookingId}/register`);
    const p1 = reg.team[0].pay;
    assert.strictEqual(p1.wage, 1100); assert.strictEqual(p1.travelPay, 150); assert.strictEqual(p1.otPay, 400);
    assert.strictEqual(p1.earned, 1100 + 400 + 150);
    console.log('  ✓ agreed wage, additional hourly charges and travel in the wages');

    // ---- automatic replacement at no extra cost ----
    const bk2 = await con('POST', '/api/contractor/bookings', Object.assign({}, base1, { payMode: 'direct', startDate: todayIST(5), days: 1 }));
    await pay(con, bk2);
    await con('POST', `/api/contractor/bookings/${bk2.bookingId}/select`, { workerId: ids.Bhavesh });
    // builder-selected worker must tick the terms when confirming
    await rejects(B('POST', `/api/worker/work/${bk2.bookingId}/confirm`, { acceptTerms: false }), 'terms_required');
    await B('POST', `/api/worker/work/${bk2.bookingId}/confirm`);
    const paymentsBefore = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n;
    const dec = await B('POST', `/api/worker/work/${bk2.bookingId}/decline`);
    assert.ok(['Anil', 'Chetan'].includes(dec.replacedBy), 'replaced automatically: ' + dec.replacedBy);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, paymentsBefore, 'no new charge to the builder');
    const repl = (await con('GET', '/api/contractor/bookings')).bookings.find(b => b.id === bk2.bookingId);
    assert.strictEqual(repl.team.length, 1); assert.notStrictEqual(repl.team[0].name, 'Bhavesh');
    assert.ok(outbox('autoReplaced').some(n => n.body.includes('no extra cost')));
    // the new worker sees the job, standard wage, and must tick terms when confirming
    const who = repl.team[0].name === 'Anil' ? A : C;
    const nw = (await who('GET', '/api/worker/work')).work.find(x => x.id === bk2.bookingId);
    assert.strictEqual(nw.wage, 900); assert.strictEqual(nw.terms_ok, false); assert.strictEqual(nw.auto_assigned, 1);
    // nobody free → builder told, job offered to all
    db.prepare("UPDATE workers SET avail_status = 'unavailable', available = 0").run();
    const other = repl.team[0].name === 'Anil' ? 'Anil' : 'Chetan';
    const dec2 = await who('POST', `/api/worker/work/${bk2.bookingId}/decline`);
    assert.strictEqual(dec2.replacedBy, null);
    assert.ok(outbox('workerCancelled').some(n => n.body.includes(other)));
    console.log('  ✓ automatic replacement at no extra cost');

    const n = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
    console.log('✔ phase 3 test passed —', n, 'WhatsApp messages queued in test mode');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error('✘ phase 3 test failed:', e.message, e.body || '', (e.stack || '').split('\n').find(l => l.includes('phase3.test'))); process.exit(1); });
