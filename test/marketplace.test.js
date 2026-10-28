'use strict';
// Projects marketplace test (clients, contractors/professionals, quotes, award fees, inspections). Was: Phase 2 end-to-end test: availability, calendar, radius, blocks, search, favourites, teams, repeat booking,
// reminders, attendance register + overtime + finalising, ratings + disputes, reports, site notices, dashboard,
// automatic levels and builder verification. Run: npm test
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lk4-'));
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
    const admin = client(base), cl = client(base), pa = client(base), pb = client(base), cl2 = client(base);
    await admin('POST', '/api/auth/admin-login', { username: 'admin', password: 'test-pass-123' });

    // ---- categories are seeded: 14 groups, 250 categories ----
    const cats = (await client(base)('GET', '/api/categories')).groups;
    assert.strictEqual(cats.length, 14); assert.strictEqual(cats.reduce((a, g) => a + g.categories.length, 0), 250);
    const rcc = cats[2].categories.find(c => c.en === 'RCC Contractor'), arch = cats[0].categories.find(c => c.en === 'Architect');
    assert.ok(rcc && arch);

    // ---- contractors / professionals sign up ----
    const aid = await signup(pa, '9600000001', 'partner');
    await rejects(pa('POST', '/api/partner/profile', { company: 'Desai Architects', city: 'Thane' }), 'no_categories');
    await pa('POST', '/api/partner/profile', { company: 'Desai Architects', city: 'Thane', categories: [arch.id], experienceYears: 12, licenceNo: 'CA/2010/1234' });
    const bid = await signup(pb, '9600000002', 'partner');
    await pb('POST', '/api/partner/profile', { company: 'Strong RCC Works', city: 'Thane', areas: 'Thane, Navi Mumbai', categories: [rcc.id], experienceYears: 8, teamSize: 40 });
    let me = await pb('GET', '/api/me');
    assert.strictEqual(me.user.role, 'partner'); assert.deepStrictEqual(me.partner.categories, [rcc.id]); assert.strictEqual(me.partner.vflags.verified, 0);
    assert.deepStrictEqual(me.projectFees, { inspection: 2000, platform: 1000 });
    await rejects(signup(client(base), '9600000002', 'worker'), 403, 'one number, one account type');
    console.log('  ✓ contractor / professional sign-up with categories');

    // ---- client (developer) posts a project ----
    const cid = await signup(cl, '9600000010', 'contractor');
    await cl('POST', '/api/contractor/profile', { company: 'Skyline Developers', bizType: 'developer' });
    assert.strictEqual((await cl('GET', '/api/me')).contractor.biz_type, 'developer');
    const proj = { categoryId: rcc.id, title: 'RCC work for G+7 building', description: 'Slab, columns, beams for 7 floors', city: 'Thane', budgetMin: 4000000, budgetMax: 6000000, startDate: todayIST(15), durationDays: 120 };
    await rejects(cl('POST', '/api/client/projects', Object.assign({}, proj, { acceptTerms: false })), 'terms_required');
    await rejects(cl('POST', '/api/client/projects', Object.assign({}, proj, { categoryId: 'nope', acceptTerms: true })), 'bad_category');
    const p1 = await cl('POST', '/api/client/projects', Object.assign({}, proj, { acceptTerms: true }));
    assert.strictEqual(p1.notified, 1, 'only the RCC contractor is told');
    assert.ok(outbox('newLead')[0].body.includes('RCC work for G+7 building'));
    assert.strictEqual((await pa('GET', '/api/partner/leads')).leads.length, 0, 'architect does not see RCC lead');
    assert.strictEqual((await pb('GET', '/api/partner/leads')).leads.length, 1);
    // directory and invite
    let dir = (await cl('GET', `/api/client/partners?category=${rcc.id}`)).partners;
    assert.strictEqual(dir.length, 1); assert.strictEqual(dir[0].company, 'Strong RCC Works'); assert.ok(!('phone' in dir[0]));
    assert.strictEqual((await cl('GET', '/api/client/partners?verified=1')).partners.length, 0);
    await cl('POST', `/api/client/projects/${p1.id}/invite`, { partnerIds: [aid] });
    assert.strictEqual((await pa('GET', '/api/partner/leads')).leads[0].invited, true, 'invited architect sees it');
    console.log('  ✓ project posted, matching leads, directory, invite');

    // ---- quotes ----
    await rejects(pb('POST', `/api/partner/projects/${p1.id}/quote`, { amount: 5200000, days: 110, acceptTerms: false }), 'terms_required');
    await pb('POST', `/api/partner/projects/${p1.id}/quote`, { amount: 5200000, days: 110, note: 'Includes shuttering', acceptTerms: true });
    await pb('POST', `/api/partner/projects/${p1.id}/quote`, { amount: 5000000, days: 110, note: 'Revised', acceptTerms: true });
    await pa('POST', `/api/partner/projects/${p1.id}/quote`, { amount: 4800000, days: 130, acceptTerms: true });
    assert.strictEqual(outbox('quoteReceived').length, 2, 'client told once per quote');
    let mine = (await cl('GET', '/api/client/projects')).projects[0];
    assert.deepStrictEqual(mine.quotes.map(q => q.amount), [4800000, 5000000]); assert.ok(mine.quotes.every(q => q.phone === null));
    await rejects(cl('POST', `/api/partner/projects/${p1.id}/quote`, { amount: 1, days: 1, acceptTerms: true }), 403, 'clients cannot quote');
    await rejects(pa('POST', `/api/client/projects`, Object.assign({}, proj, { acceptTerms: true })), 403, 'partners cannot post projects');
    console.log('  ✓ quotes compared without phone numbers');

    // ---- award: ₹2,000 inspection + ₹1,000 platform fee ----
    const bq = mine.quotes.find(q => q.company === 'Strong RCC Works');
    const aw = await cl('POST', `/api/client/projects/${p1.id}/award`, { quoteId: bq.quote_id });
    assert.strictEqual(aw.payment.amount, 3000); assert.deepStrictEqual(aw.fees, { inspection: 2000, platform: 1000 });
    mine = (await cl('GET', '/api/client/projects')).projects[0];
    assert.strictEqual(mine.status, 'open', 'not awarded until paid');
    await pay(cl, aw);
    mine = (await cl('GET', '/api/client/projects')).projects[0];
    assert.strictEqual(mine.status, 'awarded'); assert.strictEqual(mine.payment_status, 'paid');
    assert.strictEqual(mine.quotes.find(q => q.status === 'accepted').phone, '9600000002', 'phone revealed after payment');
    assert.ok(outbox('projectAwarded')[0].body.includes('9600000010'), 'contractor gets client phone');
    const bw = (await pb('GET', '/api/partner/work')).work[0];
    assert.strictEqual(bw.quote.status, 'accepted'); assert.strictEqual(bw.client_phone, '9600000010');
    assert.strictEqual((await pa('GET', '/api/partner/work')).work[0].quote.status, 'rejected');
    assert.strictEqual((await pa('GET', '/api/partner/work')).work[0].client_phone, null);
    const pays = (await admin('GET', '/api/admin/payments')).payments.filter(p => p.kind === 'project');
    assert.strictEqual(pays.length, 1); assert.strictEqual(pays[0].amount, 3000);
    // admin can change the fees
    await admin('PUT', '/api/admin/settings', { project_inspection_fee: 2500, project_platform_fee: 1200 });
    assert.deepStrictEqual((await cl('GET', '/api/me')).projectFees, { inspection: 2500, platform: 1200 });
    await admin('PUT', '/api/admin/settings', { project_inspection_fee: 2000, project_platform_fee: 1000 });
    console.log('  ✓ award charges inspection ₹2,000 + platform ₹1,000, then reveals contacts');

    // ---- inspection by an assigned supervisor ----
    const g = await admin('POST', '/api/admin/staff/groups', { name: 'Inspectors', perms: [] });
    const st = await admin('POST', '/api/admin/staff/users', { name: 'Inspector Rao', username: 'rao', password: 'rao-pass-12', group_id: g.id });
    await admin('POST', `/api/admin/projects/${p1.id}/inspector`, { staffId: st.id });
    const ins = client(base); await ins('POST', '/api/auth/admin-login', { username: 'rao', password: 'rao-pass-12' });
    assert.strictEqual((await ins('GET', '/api/admin/my-inspections')).projects.length, 1);
    assert.strictEqual((await ins('GET', '/api/admin/overview')).myInspections, 1);
    await rejects(ins('GET', '/api/admin/projects'), 403, 'no projects permission');
    await rejects(ins('POST', `/api/admin/projects/${p1.id}/inspection`, { status: 'passed' }), 400, 'notes needed');
    await ins('POST', `/api/admin/projects/${p1.id}/inspection`, { status: 'issues', notes: 'Cover blocks missing on 3rd floor slab' });
    assert.strictEqual(outbox('inspectionResult').length, 2, 'client and contractor both told');
    assert.strictEqual((await cl('GET', '/api/client/projects')).projects[0].inspection_status, 'issues');
    console.log('  ✓ inspection assigned and recorded, both sides told');

    // ---- complete, rate, dispute ----
    await rejects(cl('POST', `/api/client/projects/${p1.id}/rate`, { stars: 4 }), 'not_finished');
    await cl('POST', `/api/client/projects/${p1.id}/complete`);
    await cl('POST', `/api/client/projects/${p1.id}/rate`, { stars: 2, comment: 'Delays' });
    assert.deepStrictEqual((await pb('GET', '/api/me')).partner.stats, { rating: { avg: 2, count: 1 }, completed: 1, won: 1 });
    await pb('POST', `/api/partner/ratings/${p1.id}/dispute`, { text: 'Delay was due to client drawings' });
    const rep = (await admin('GET', '/api/admin/reports')).reports.find(r => r.kind === 'rating');
    await admin('POST', `/api/admin/reports/${rep.id}/resolve`, { resolution: 'Drawings were late', ratingAction: 'remove' });
    assert.strictEqual((await pb('GET', '/api/me')).partner.stats.rating.count, 0, 'removed rating no longer counts');
    console.log('  ✓ completion, rating, dispute');

    // ---- admin: verification, categories, projects, cancel, delete ----
    await admin('PATCH', `/api/admin/partners/${bid}`, { verified_docs: true, verified_licence: true });
    assert.strictEqual((await cl('GET', '/api/client/partners?verified=1')).partners.length, 1);
    const nc = await admin('POST', '/api/admin/svc/categories', { group_id: 'g01', en: 'Vastu Consultant', hi: 'वास्तु सलाहकार' });
    assert.ok((await client(base)('GET', '/api/categories')).groups[0].categories.some(c => c.id === nc.id));
    await admin('PATCH', `/api/admin/svc/categories/${nc.id}`, { active: false });
    assert.ok(!(await client(base)('GET', '/api/categories')).groups[0].categories.some(c => c.id === nc.id));
    const ap = (await admin('GET', '/api/admin/projects')).projects[0];
    assert.strictEqual(ap.awarded.company, 'Strong RCC Works'); assert.strictEqual(ap.inspector_name, 'Inspector Rao');
    const p2 = await cl('POST', '/api/client/projects', Object.assign({}, proj, { title: 'Second tower RCC', acceptTerms: true }));
    await cl('POST', `/api/client/projects/${p2.id}/cancel`);
    assert.strictEqual((await pb('GET', '/api/partner/leads')).leads.length, 0, 'cancelled project hidden');
    // admin requires verified partners for leads
    await admin('PUT', '/api/admin/settings', { partner_leads_verified_only: 1 });
    const p3 = await cl('POST', '/api/client/projects', Object.assign({}, proj, { categoryId: arch.id, title: 'Architect for villa', acceptTerms: true }));
    assert.strictEqual(p3.notified, 0, 'unverified architect not told when admin requires verification');
    await admin('DELETE', `/api/admin/partners/${aid}`);
    assert.ok(!(await admin('GET', '/api/admin/partners')).partners.some(p => p.partner_id === aid));
    const ov = await admin('GET', '/api/admin/overview');
    assert.strictEqual(ov.partners, 1); assert.ok(ov.openProjects >= 1); assert.strictEqual(ov.awardedProjects, 1);
    console.log('  ✓ admin: verification, categories, projects, settings');

    const n = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
    console.log('✔ marketplace test passed —', n, 'WhatsApp messages queued in test mode');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error('✘ marketplace test failed:', e.message, e.body || '', (e.stack || '').split('\n').find(l => l.includes('marketplace.test'))); process.exit(1); });
