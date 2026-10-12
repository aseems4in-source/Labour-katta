'use strict';
// End-to-end smoke test in test mode (no Razorpay / WhatsApp keys). Run: npm test
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.ADMIN_PHONES = '9000000001';
process.env.NODE_ENV = 'test';
delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID;

const { createApp } = require('../src/app');
const { todayIST } = require('../src/util');

function client(base) {
  let cookie = '';
  return async function call(method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`${method} ${url} -> ${res.status} ${json.error}`); e.status = res.status; e.body = json; throw e; }
    return json;
  };
}
async function login(call, phone, role) {
  const otp = await call('POST', '/api/auth/request-otp', { phone });
  assert.ok(otp.devCode, 'test mode returns code');
  await assert.rejects(call('POST', '/api/auth/verify-otp', { phone, code: '000000' === otp.devCode ? '111111' : '000000' }), /not right/);
  await call('POST', '/api/auth/verify-otp', { phone, code: otp.devCode });
  if (role) await call('POST', '/api/me/role', { role });
}

(async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const admin = client(base), con = client(base), w1 = client(base), w2 = client(base), w3 = client(base);
    // admin
    await login(admin, '9000000001');
    let me = await admin('GET', '/api/me');
    assert.strictEqual(me.user.isAdmin, true);
    assert.strictEqual(me.skills.length, 20);
    await admin('PUT', '/api/admin/settings', { job_fee: 120, contractor_plan: 599 });
    const { skill } = await admin('POST', '/api/admin/skills', { en: 'Scaffolding fitter', hi: 'स्कैफ़ोल्डिंग फिटर', mr: 'स्कॅफोल्डिंग फिटर', cat: 'skilled', wage: 1000 });
    await admin('PATCH', '/api/admin/skills/s02', { wage: 1000 });
    await admin('DELETE', '/api/admin/skills/s20');
    me = await admin('GET', '/api/me');
    assert.strictEqual(me.skills.length, 20, 'one added, one removed');
    assert.strictEqual(me.settings.job_fee, 120);

    // non-admin cannot reach admin
    await login(con, '9876543210', 'contractor');
    await assert.rejects(con('GET', '/api/admin/overview'), e => e.status === 403);
    await con('POST', '/api/contractor/profile', { company: 'Sai Builders', gst: '' });

    // workers join
    await login(w1, '9876500001', 'worker');
    await w1('POST', '/api/worker/profile', { name: 'Ramesh Patil', area: 'Thane', experience: '3-5', skills: ['s02', skill.id] });
    await login(w2, '9876500002', 'worker');
    await w2('POST', '/api/worker/profile', { name: 'Imran Shaikh', area: 'Bhiwandi', experience: '5+', skills: ['s02'] });
    await login(w3, '9876500003', 'worker');
    await w3('POST', '/api/worker/profile', { name: 'Sunil Jadhav', area: 'Kalyan', experience: '1-3', skills: ['s02'] });

    // membership: test UPI for w1, w2; cash for w3 confirmed by admin
    for (const w of [w1, w2]) {
      const m = await w('POST', '/api/worker/membership', { method: 'upi' });
      assert.strictEqual(m.payment.mode, 'test'); assert.strictEqual(m.payment.amount, 9);
      await w('POST', '/api/payments/test-complete', { paymentId: m.payment.paymentId });
    }
    await w3('POST', '/api/worker/membership', { method: 'cash' });
    assert.deepStrictEqual((await w3('GET', '/api/worker/jobs')).jobs, [], 'no jobs before cash confirmed');
    const w3id = (await w3('GET', '/api/me')).user.id;
    await admin('POST', `/api/admin/workers/${w3id}/cash-received`);
    assert.strictEqual((await w3('GET', '/api/me')).worker.membership_status, 'active');

    // contractor books 2 RCC workers, pays through Labour Katta (no plan → job fee 120)
    const start = todayIST(1);
    const bk = await con('POST', '/api/contractor/bookings', { skillId: 's02', count: 2, days: 5, level: 'any', qc: true, payMode: 'lk', site: 'Site 14, Thane West', startDate: start });
    // price = (1000 + 150) * 2 * 5 + 500*5 + 120 = 11500 + 2500 + 120 = 14120
    assert.strictEqual(bk.payment.amount, 14120);
    assert.deepStrictEqual((await w1('GET', '/api/worker/jobs')).jobs, [], 'unpaid booking is hidden');
    await con('POST', '/api/payments/test-complete', { paymentId: bk.payment.paymentId });

    const jobs = (await w1('GET', '/api/worker/jobs')).jobs;
    assert.strictEqual(jobs.length, 1); assert.strictEqual(jobs[0].wage, 1000);
    await w1('POST', `/api/worker/jobs/${bk.bookingId}/accept`);
    await assert.rejects(w1('POST', `/api/worker/jobs/${bk.bookingId}/accept`), e => e.status === 409);
    const second = await w2('POST', `/api/worker/jobs/${bk.bookingId}/accept`);
    assert.strictEqual(second.full, true);
    await assert.rejects(w3('POST', `/api/worker/jobs/${bk.bookingId}/accept`), e => e.status === 409, 'cannot over-fill');

    let list = (await con('GET', '/api/contractor/bookings')).bookings;
    assert.strictEqual(list[0].status, 'assigned'); assert.strictEqual(list[0].team.length, 2);

    // attendance + replacement → w3 can now take the open slot
    const w2id = (await w2('GET', '/api/me')).user.id;
    await con('POST', `/api/contractor/bookings/${bk.bookingId}/attendance`, { workerId: w2id, status: 'absent' });
    await con('POST', `/api/contractor/bookings/${bk.bookingId}/replace`, { workerId: w2id });
    assert.strictEqual((await w3('GET', '/api/worker/jobs')).jobs.length, 1);
    await w3('POST', `/api/worker/jobs/${bk.bookingId}/accept`);
    list = (await con('GET', '/api/contractor/bookings')).bookings;
    assert.deepStrictEqual(list[0].team.map(t => t.name).sort(), ['Ramesh Patil', 'Sunil Jadhav']);

    // contractor plan → next booking has no job fee; direct pay with no QC needs no payment
    const plan = await con('POST', '/api/contractor/plan');
    assert.strictEqual(plan.payment.amount, 599);
    await con('POST', '/api/payments/test-complete', { paymentId: plan.payment.paymentId });
    const bk2 = await con('POST', '/api/contractor/bookings', { skillId: skill.id, count: 1, days: 3, level: 'gold', qc: false, payMode: 'direct', site: 'Site 9, Airoli', startDate: start });
    assert.strictEqual(bk2.paid, true, 'no payment needed');
    assert.strictEqual((await w1('GET', '/api/worker/jobs')).jobs.length, 0, 'gold-only job hidden from bronze worker');
    const w1id = (await w1('GET', '/api/me')).user.id;
    await admin('PATCH', `/api/admin/workers/${w1id}`, { tier: 'gold', custom_wage: 1300 });
    const goldJobs = (await w1('GET', '/api/worker/jobs')).jobs;
    assert.strictEqual(goldJobs.length, 1); assert.strictEqual(goldJobs[0].wage, 1300, 'custom wage applies');
    await w1('POST', `/api/worker/jobs/${bk2.bookingId}/accept`);
    await w1('POST', `/api/worker/work/${bk2.bookingId}/paid`, { received: false });

    // messages recorded in the outbox
    const outbox = (await admin('GET', '/api/admin/notifications')).notifications;
    const kinds = new Set(outbox.map(n => n.template));
    for (const k of ['bookingReceived', 'teamReady', 'jobConfirmed', 'jobOffer', 'replacement', 'planStarted', 'membershipStarted', 'paymentIssue']) assert.ok(kinds.has(k), 'outbox has ' + k);
    assert.ok(outbox.every(n => n.status === 'test'));
    const conMsgs = (await con('GET', '/api/messages')).messages;
    assert.ok(conMsgs.some(m => /Your team is ready/.test(m.body)));

    // validation
    await assert.rejects(con('POST', '/api/contractor/bookings', { skillId: 's02', count: 0, days: 5, payMode: 'lk', site: 'x', startDate: start }), e => e.status === 400);
    await assert.rejects(con('POST', '/api/contractor/bookings', { skillId: 's02', count: 1, days: 5, payMode: 'lk', site: 'x', startDate: '2020-01-01' }), e => e.status === 400);
    await assert.rejects(admin('POST', '/api/auth/request-otp', { phone: '12345' }), e => e.status === 400);

    // webhook rejects unsigned calls
    const wh = await fetch(base + '/api/webhooks/razorpay', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.strictEqual(wh.status, 400);

    const ov = await admin('GET', '/api/admin/overview');
    assert.strictEqual(ov.activeMembers, 3); assert.strictEqual(ov.activePlans, 1);
    console.log('✔ smoke test passed —', outbox.length, 'WhatsApp messages queued in test mode');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error('✘ smoke test failed:', e.message, e.body || ''); process.exit(1); });
