'use strict';
// End-to-end smoke test in test mode (no Razorpay / WhatsApp keys). Run: npm test
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.ADMIN_PHONES = '';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-pass-123';
process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT = '1000';
delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID;

const { createApp } = require('../src/app');
const { todayIST } = require('../src/util');

function client(base) {
  let cookies = {};
  return async function call(method, url, body) {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) cookies[k] = v; else delete cookies[k]; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`${method} ${url} -> ${res.status} ${json.error}`); e.status = res.status; e.body = json; throw e; }
    return json;
  };
}
async function login(call, phone, portal) {
  const otp = await call('POST', '/api/auth/request-otp', { phone });
  assert.ok(otp.devCode, 'test mode returns code');
  await assert.rejects(call('POST', '/api/auth/verify-otp', { phone, portal, code: otp.devCode === '000000' ? '111111' : '000000' }), /not right/);
  await call('POST', '/api/auth/verify-otp', { phone, portal, code: otp.devCode });
}
async function testPay(call, payment) {
  assert.strictEqual(payment.mode, 'test');
  await call('POST', '/api/payments/test-complete', { paymentId: payment.paymentId });
}

(async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const admin = client(base), con = client(base), con2 = client(base), w1 = client(base), w2 = client(base), w3 = client(base);

    // ---- admin (username + password) ----
    await assert.rejects(admin('GET', '/api/admin/overview'), e => e.status === 401);
    await assert.rejects(admin('POST', '/api/auth/admin-login', { username: 'admin', password: 'wrong-pass' }), e => e.status === 401);
    await admin('POST', '/api/auth/admin-login', { username: 'admin', password: 'test-pass-123' });
    let me = await admin('GET', '/api/me');
    assert.strictEqual(me.adminSession, true);
    assert.strictEqual(me.skills.length, 20);
    await admin('PUT', '/api/admin/settings', { job_fee: 120, contractor_plan: 599 });
    const { skill } = await admin('POST', '/api/admin/skills', { en: 'Scaffolding fitter', hi: 'स्कैफ़ोल्डिंग फिटर', mr: 'स्कॅफोल्डिंग फिटर', cat: 'skilled', wage: 1000 });
    await admin('PATCH', '/api/admin/skills/s02', { wage: 1000 });
    await admin('DELETE', '/api/admin/skills/s20');
    assert.strictEqual((await admin('GET', '/api/me')).skills.length, 20, 'one added, one removed');

    // ---- contractor: must pay ₹599 upfront before booking ----
    await login(con, '9876543210', 'contractor');
    assert.strictEqual((await con('GET', '/api/me')).user.role, 'contractor');
    await assert.rejects(con('GET', '/api/admin/overview'), e => e.status === 401 || e.status === 403);
    await con('POST', '/api/contractor/profile', { company: 'Sai Builders', gst: '' });
    me = await con('GET', '/api/me');
    assert.strictEqual(me.contractor.access, false);
    assert.strictEqual(me.contractor.planPrice, 599);
    const start = todayIST(1);
    await assert.rejects(con('POST', '/api/contractor/bookings', { skillId: 's02', count: 2, days: 5, payMode: 'lk', site: 'Site 14', startDate: start }), e => e.status === 402, 'unpaid contractor cannot book');
    const plan = await con('POST', '/api/contractor/plan');
    assert.strictEqual(plan.payment.amount, 599);
    await testPay(con, plan.payment);
    assert.strictEqual((await con('GET', '/api/me')).contractor.access, true);

    // ---- portals are separate ----
    await login(w1, '9876500001', 'worker');
    const wrongPortal = async (phone, portal) => { const c = client(base); const o = await c('POST', '/api/auth/request-otp', { phone }); return c('POST', '/api/auth/verify-otp', { phone, portal, code: o.devCode }); };
    await new Promise(r => setTimeout(r, 0));
    await assert.rejects(wrongPortal('9876500001', 'contractor'), e => e.status === 403 && /Login as Worker/.test(e.message));
    await assert.rejects(wrongPortal('9876543210', 'worker'), e => e.status === 403 && /Login as Builder/.test(e.message));
    await assert.rejects(w1('GET', '/api/contractor/bookings'), e => e.status === 403);

    // ---- workers ----
    await w1('POST', '/api/worker/profile', { name: 'Ramesh Patil', area: 'Thane', experience: '3-5', skills: ['s02', skill.id] });
    await login(w2, '9876500002', 'worker');
    await w2('POST', '/api/worker/profile', { name: 'Imran Shaikh', area: 'Bhiwandi', experience: '5+', skills: ['s02'] });
    await login(w3, '9876500003', 'worker');
    await w3('POST', '/api/worker/profile', { name: 'Sunil Jadhav', area: 'Kalyan', experience: '1-3', skills: ['s02'] });

    // w1 pays UPI ₹9; w2 gets a free trial from admin; w3 pays cash confirmed by admin
    const m1 = await w1('POST', '/api/worker/membership', { method: 'upi' });
    assert.strictEqual(m1.payment.amount, 9);
    await testPay(w1, m1.payment);
    const w2id = (await w2('GET', '/api/me')).user.id;
    await admin('POST', `/api/admin/workers/${w2id}/trial`, { days: 30 });
    assert.strictEqual((await w2('GET', '/api/me')).worker.access, true, 'trial gives access');
    await w3('POST', '/api/worker/membership', { method: 'cash' });
    const w3id = (await w3('GET', '/api/me')).user.id;

    // ---- booking (plan active → no job fee) ----
    const bk = await con('POST', '/api/contractor/bookings', { skillId: 's02', count: 2, days: 5, level: 'any', qc: true, payMode: 'lk', site: 'Site 14, Thane West', startDate: start });
    // (1000 + 150) * 2 * 5 + 500 * 5 + 0 job fee = 14000
    assert.strictEqual(bk.payment.amount, 14000);
    assert.deepStrictEqual((await w1('GET', '/api/worker/jobs')).jobs, [], 'unpaid booking is hidden');
    await testPay(con, bk.payment);

    assert.deepStrictEqual((await w3('GET', '/api/worker/jobs')).jobs, [], 'unpaid worker sees no jobs');
    let outbox = (await admin('GET', '/api/admin/notifications')).notifications;
    const w3phoneMsgs = outbox.filter(n => n.phone === '9876500003');
    assert.strictEqual(w3phoneMsgs.length, 0, 'unpaid worker gets no WhatsApp');
    assert.ok(outbox.some(n => n.phone === '9876500001' && n.template === 'jobOffer'), 'paid worker got job offer');
    assert.ok(outbox.some(n => n.phone === '9876500002' && n.template === 'jobOffer'), 'trial worker got job offer');
    await admin('POST', `/api/admin/workers/${w3id}/cash-received`);
    assert.strictEqual((await w3('GET', '/api/me')).worker.membership_status, 'active');

    const jobs = (await w1('GET', '/api/worker/jobs')).jobs;
    assert.strictEqual(jobs.length, 1); assert.strictEqual(jobs[0].wage, 1000);
    await w1('POST', `/api/worker/jobs/${bk.bookingId}/accept`);
    await assert.rejects(w1('POST', `/api/worker/jobs/${bk.bookingId}/accept`), e => e.status === 409);
    assert.strictEqual((await w2('POST', `/api/worker/jobs/${bk.bookingId}/accept`)).full, true);
    await assert.rejects(w3('POST', `/api/worker/jobs/${bk.bookingId}/accept`), e => e.status === 409, 'cannot over-fill');

    let list = (await con('GET', '/api/contractor/bookings')).bookings;
    assert.strictEqual(list[0].status, 'assigned'); assert.strictEqual(list[0].team.length, 2);

    // attendance + replacement
    await con('POST', `/api/contractor/bookings/${bk.bookingId}/attendance`, { workerId: w2id, status: 'absent' });
    await con('POST', `/api/contractor/bookings/${bk.bookingId}/replace`, { workerId: w2id });
    await w3('POST', `/api/worker/jobs/${bk.bookingId}/accept`);
    list = (await con('GET', '/api/contractor/bookings')).bookings;
    assert.deepStrictEqual(list[0].team.map(t => t.name).sort(), ['Ramesh Patil', 'Sunil Jadhav']);

    // gold job + custom wage, direct pay
    const bk2 = await con('POST', '/api/contractor/bookings', { skillId: skill.id, count: 1, days: 3, level: 'gold', qc: false, payMode: 'direct', site: 'Site 9, Airoli', startDate: todayIST(10) });
    assert.strictEqual(bk2.paid, true, 'no payment needed');
    assert.strictEqual((await w1('GET', '/api/worker/jobs')).jobs.length, 0, 'gold-only job hidden from bronze worker');
    const w1id = (await w1('GET', '/api/me')).user.id;
    await admin('PATCH', `/api/admin/workers/${w1id}`, { tier: 'gold', custom_wage: 1300 });
    const goldJobs = (await w1('GET', '/api/worker/jobs')).jobs;
    assert.strictEqual(goldJobs.length, 1); assert.strictEqual(goldJobs[0].wage, 1300);
    await w1('POST', `/api/worker/jobs/${bk2.bookingId}/accept`);
    await w1('POST', `/api/worker/work/${bk2.bookingId}/paid`, { received: false });

    // ---- one order with skilled and unskilled lines, site address and map pin ----
    const ord = await con('POST', '/api/contractor/bookings', {
      lines: [{ skillId: 's01', count: 2 }, { skillId: 's15', count: 3 }, { skillId: 's01', count: 0 }],
      days: 3, level: 'any', qc: true, payMode: 'lk', site: 'Site 21', siteAddress: 'Plot 4, Wagle Estate, Thane West', siteLat: 19.2, siteLng: 72.96, startDate: start });
    // Mason (900+150)*2*3 = 6300; Helper (600+150)*3*3 = 6750; QC once 500*3 = 1500; no job fee on plan
    assert.strictEqual(ord.payment.amount, 14550);
    assert.strictEqual(ord.bookingIds.length, 2);
    await testPay(con, ord.payment);
    let mine = (await con('GET', '/api/contractor/bookings')).bookings.filter(b => b.group_id === ord.groupId);
    assert.strictEqual(mine.length, 2); assert.ok(mine.every(b => b.status === 'open' && b.payment_status === 'paid'));
    assert.strictEqual(mine.filter(b => b.qc_cost > 0).length, 1, 'quality in-charge charged once');
    assert.strictEqual(mine[0].site_address, 'Plot 4, Wagle Estate, Thane West'); assert.strictEqual(mine[0].site_lat, 19.2);
    await assert.rejects(con('POST', '/api/contractor/bookings', { lines: [{ skillId: 's01', count: 0 }], days: 1, payMode: 'lk', site: 'x', startDate: start }), e => e.status === 400);

    // ---- contractor chooses available workers by name ----
    const later = todayIST(20);
    const counts = (await con('GET', `/api/contractor/availability?start=${later}&days=2&level=any`)).counts;
    assert.strictEqual(counts.s02, 3, 'all three RCC workers free later');
    assert.strictEqual((await con('GET', `/api/contractor/availability?start=${start}&days=2&level=any`)).counts.s02, 1, 'only Imran is free on the busy dates');
    const pick = await con('POST', '/api/contractor/bookings', { lines: [{ skillId: 's02', count: 2 }], days: 2, payMode: 'direct', site: 'Site 30', startDate: later });
    let avail = (await con('GET', `/api/contractor/bookings/${pick.bookingId}/available-workers`)).workers;
    assert.strictEqual(avail.length, 3); assert.strictEqual(avail[0].name, 'Ramesh Patil', 'gold worker listed first');
    assert.ok(!('phone' in avail[0]), 'phone hidden before selection');
    await w2('POST', '/api/worker/availability', { available: false });
    avail = (await con('GET', `/api/contractor/bookings/${pick.bookingId}/available-workers`)).workers;
    assert.ok(!avail.some(w => w.worker_id === w2id), 'unavailable worker hidden');
    await assert.rejects(con('POST', `/api/contractor/bookings/${pick.bookingId}/select`, { workerId: w2id }), e => e.status === 409);
    await w2('POST', '/api/worker/availability', { available: true });
    await con('POST', `/api/contractor/bookings/${pick.bookingId}/select`, { workerId: w2id });
    assert.strictEqual((await con('POST', `/api/contractor/bookings/${pick.bookingId}/select`, { workerId: w3id })).full, true);
    assert.ok((await w2('GET', '/api/worker/work')).work.some(j => j.id === pick.bookingId), 'selected job shows in worker My work');
    await assert.rejects(w1('POST', `/api/contractor/bookings/${pick.bookingId}/select`, { workerId: w1id }), e => e.status === 403);
    // worker can't go → place reopens and is offered again
    await w2('POST', `/api/worker/work/${pick.bookingId}/decline`);
    let pk = (await con('GET', '/api/contractor/bookings')).bookings.find(b => b.id === pick.bookingId);
    assert.strictEqual(pk.status, 'open'); assert.strictEqual(pk.team.length, 1);
    avail = (await con('GET', `/api/contractor/bookings/${pick.bookingId}/available-workers`)).workers;
    assert.deepStrictEqual(avail.map(w => w.name), ['Ramesh Patil']);
    // a worker on overlapping dates does not see the job
    const clash = await con('POST', '/api/contractor/bookings', { lines: [{ skillId: 's02', count: 1 }], days: 1, payMode: 'direct', site: 'Clash', startDate: later });
    assert.ok(!(await w3('GET', '/api/worker/jobs')).jobs.some(j => j.id === clash.bookingId), 'busy worker not offered overlapping job');

    // ---- second contractor: special price and free trial from admin ----
    await login(con2, '9876543211', 'contractor');
    await con2('POST', '/api/contractor/profile', { company: 'Shree Constructions' });
    const c2id = (await con2('GET', '/api/me')).user.id;
    await admin('POST', `/api/admin/contractors/${c2id}/price`, { price: 299 });
    assert.strictEqual((await con2('GET', '/api/me')).contractor.planPrice, 299);
    assert.strictEqual((await con2('POST', '/api/contractor/plan')).payment.amount, 299, 'special price used');
    await admin('POST', `/api/admin/contractors/${c2id}/trial`, { days: 14 });
    assert.strictEqual((await con2('GET', '/api/me')).contractor.access, true);
    await con2('POST', '/api/contractor/bookings', { skillId: 's01', count: 1, days: 1, level: 'any', qc: false, payMode: 'direct', site: 'Kalyan site', startDate: start });

    // ---- admin opens contractor and worker portals ----
    await admin('POST', '/api/admin/act-as', { userId: c2id });
    me = await admin('GET', '/api/me');
    assert.strictEqual(me.user.role, 'contractor'); assert.strictEqual(me.user.actingAs, true); assert.strictEqual(me.user.name, 'Shree Constructions');
    assert.strictEqual((await admin('GET', '/api/contractor/bookings')).bookings.length, 1);
    await admin('GET', '/api/admin/overview'); // still admin while viewing
    await admin('POST', '/api/admin/act-as', { userId: w1id });
    assert.strictEqual((await admin('GET', '/api/me')).user.role, 'worker');
    await admin('POST', '/api/auth/stop-acting');
    me = await admin('GET', '/api/me');
    assert.strictEqual(me.user, null); assert.strictEqual(me.adminSession, true);
    await assert.rejects(con('POST', '/api/admin/act-as', { userId: w1id }), e => e.status === 403, 'contractor cannot act as others');

    // ---- messages ----
    outbox = (await admin('GET', '/api/admin/notifications')).notifications;
    const kinds = new Set(outbox.map(n => n.template));
    for (const k of ['bookingReceived', 'teamReady', 'jobConfirmed', 'jobOffer', 'replacement', 'planStarted', 'membershipStarted']) assert.ok(kinds.has(k), 'outbox has ' + k);
    assert.ok(outbox.every(n => n.status === 'test'));
    assert.ok((await con('GET', '/api/messages')).messages.some(m => /Your team is ready/.test(m.body)));

    // validation and security
    await assert.rejects(con('POST', '/api/contractor/bookings', { skillId: 's02', count: 0, days: 5, payMode: 'lk', site: 'x', startDate: start }), e => e.status === 400);
    await assert.rejects(con('POST', '/api/contractor/bookings', { skillId: 's02', count: 1, days: 5, payMode: 'lk', site: 'x', startDate: '2020-01-01' }), e => e.status === 400);
    await assert.rejects(client(base)('POST', '/api/auth/request-otp', { phone: '12345' }), e => e.status === 400);
    const wh = await fetch(base + '/api/webhooks/razorpay', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.strictEqual(wh.status, 400);

    await admin('POST', '/api/auth/logout');
    await assert.rejects(admin('GET', '/api/admin/overview'), e => e.status === 401);
    console.log('✔ smoke test passed —', outbox.length, 'WhatsApp messages queued in test mode');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error('✘ smoke test failed:', e.message, e.body || '', (e.stack||'').split('\n').find(l => l.includes('smoke.test'))); process.exit(1); });
