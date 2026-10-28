(function () {
'use strict';
// ---------- helpers ----------
const T = window.LK_T;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('lk_' + k); localStorage.setItem('lk_' + k, v); } catch (e) { return null; } };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const n0 = (v) => { const n = parseInt(v, 10); return isNaN(n) || n < 0 ? 0 : n; };
const istDate = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + (offset || 0) * 86400000));
const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso); return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); };
const fmtTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

const S = {
  me: null, lang: store('lang') || 'en', view: store('view') || 'app',
  ctab: 'home', wtab: 'jobs', atab: 'overview',
  portal: store('portal') || '', login: { phone: '', code: '', sent: false, devCode: '' }, adm: { open: false, user: '', pass: '' },
  f: { qty: {}, days: 5, level: 'any', qc: false, pay: 'lk', site: '', siteAddress: '', lat: null, lng: null, start: '',
       company: '', gst: '', wname: '', warea: '', wexp: '1-3', wupi: '', wcat: 'skilled', wskills: {}, memMethod: 'upi',
       newEn: '', newHi: '', newMr: '', newCat: 'skilled', newWage: '', coupon: '', couponCode: '',
       aw: { phone: '', name: '', area: '', experience: '', coupon: '', skills: {} }, ab: { phone: '', company: '', gst: '', coupon: '' },
       cp: { code: '', applies_to: 'both', kind: 'percent', value: '', max_uses: '', expires: '', note: '' },
       grp: { name: '', perms: {} }, st: { name: '', username: '', password: '', phone: '', group_id: '' },
       mk: 'mine', bizType: 'builder', pterms: false, qterms: false, reportTime: '09:00', otRate: '', travel: '', bterms: false, wterms: false, ask: { wage: '', travel: '', note: '' }, prefer: [], noticeText: '', teamName: '', busyUntil: '', availPick: '', disputeText: '', rf: 'open' },
  ws: { skill: '', area: '', exp: '', minRating: '', maxWage: '', level: 'any', start: '', days: '1', verified: false, fav: false, results: null, total: 0 },
  askFor: '', cats: null, ptab: 'leads', quoteFor: '', awardConfirm: '', pdisputeFor: '',
  pp: { company: '', contactName: '', city: '', areas: '', experienceYears: '', teamSize: '', gst: '', licenceNo: '', about: '', cats: {}, catQ: '' },
  np: { categoryId: '', title: '', description: '', city: '', siteAddress: '', lat: null, lng: null, budgetMin: '', budgetMax: '', startDate: '', durationDays: '', invite: [], onlyInvited: false },
  dir: { category: '', city: '', verified: false, results: null, total: 0 },
  qf: { amount: '', days: '', note: '' },
  pf: { area: '', exp: '', minRating: '', maxWage: '', verified: false, fav: false },
  rep: { kind: 'problem', category: 'other', bookingId: '', text: '', urgent: false },
  panel: {}, reg: null, confirmBlock: '', disputeFor: '',
  data: { bookings: [], jobs: [], work: [], messages: [], avail: {}, dash: null, teams: [], reports: [], blocks: [], calendar: null, ratings: null, leads: [], pwork: [], cprojects: [] }, admin: {}, pick: { id: '', list: [], needed: 0 }, confirmDecline: '',
  cfgDraft: null, confirmCancel: '', confirmDel: '', confirmDelUser: '', edit: null, formOpen: {}, q: '', err: '', busy: false,
};
const t = (k, p) => { let s = (T[S.lang] && T[S.lang][k]) || T.en[k] || k; if (p) Object.keys(p).forEach(x => { s = s.split('{' + x + '}').join(p[x]); }); return s; };
const skillName = (s) => s ? (S.lang === 'hi' ? (s.hi || s.en) : S.lang === 'mr' ? (s.mr || s.en) : s.en) : '—';
const bSkill = (b) => (S.lang === 'hi' ? b.skill_hi : S.lang === 'mr' ? b.skill_mr : b.skill_en) || b.skill_en;
const settings = () => (S.me && S.me.settings) || {};
const isAdmin = () => !!(S.me && ((S.me.user && S.me.user.isAdmin) || S.me.adminSession));

let toastTimer;
function toast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500); }

async function api(method, url, body) {
  let res;
  try { res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch (e) { throw new Error(t('networkError')); }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me && (S.me.user || S.me.adminSession)) { await loadMe(); render(); }
  if (!res.ok) { const e = new Error(json.error || t('networkError')); e.code = json.code; e.status = res.status; throw e; }
  return json;
}
async function act(fn) {
  if (S.busy) return; S.busy = true; S.err = '';
  try { await fn(); } catch (e) { const m = (T.en['err_' + e.code] ? t('err_' + e.code) : e.message); S.err = m; toast(m); } finally { S.busy = false; render(); }
}

// ---------- data loading ----------
async function loadMe() { S.me = await api('GET', '/api/me'); if (S.me.user && S.me.user.lang && !store('lang')) S.lang = S.me.user.lang; }
async function loadTab() {
  const u = S.me && S.me.user; if (!u && !isAdmin()) return;
  try {
    if ((S.view === 'admin' || !u) && isAdmin()) {
      const map = { overview: ['overview'], reports: ['reports'], mprojects: ['projects', 'staff-names'], partners: ['partners'], categories: ['svc'], myinsp: ['my-inspections'], mywork: ['my-work'], pricing: ['settings'], skills: ['skills'], workers: ['workers', 'skills'], contractors: ['contractors'], bookings: ['bookings', 'staff-names'], coupons: ['coupons'], staff: ['staff'], payments: ['payments'], outbox: ['notifications'] };
      const whole = { overview: 1, 'my-work': 1, staff: 1, svc: 1, 'my-inspections': 1 }, field = { 'staff-names': 'staff' };
      for (const k of map[S.atab] || []) {
        const r = await api('GET', '/api/admin/' + k);
        S.admin[k] = whole[k] ? r : r[field[k] || k];
      }
    } else if (u.role === 'partner') {
      await loadCats();
      if (S.me.partner) {
        if (S.ptab === 'leads') S.data.leads = (await api('GET', '/api/partner/leads')).leads;
        if (S.ptab === 'work') S.data.pwork = (await api('GET', '/api/partner/work')).work;
        if (S.ptab === 'support') await loadSupport();
        if (S.ptab === 'messages') S.data.messages = (await api('GET', '/api/messages')).messages;
      }
    } else if (u.role === 'contractor' && S.me.contractor) {
      if (S.ctab === 'projects') { await loadCats(); S.data.cprojects = (await api('GET', '/api/client/projects')).projects; }
      if (['home', 'bookings', 'support'].includes(S.ctab)) S.data.bookings = (await api('GET', '/api/contractor/bookings')).bookings;
      if (S.ctab === 'home') S.data.dash = await api('GET', '/api/contractor/dashboard');
      if (S.ctab === 'workers') { S.data.teams = (await api('GET', '/api/contractor/teams')).teams; if (!S.ws.results) await searchWorkers(); }
      if (S.ctab === 'support') await loadSupport();
      if (S.ctab === 'bookings' && S.reg && S.panel[S.reg.id] === 'reg') await loadReg(S.reg.id);
      if (S.ctab === 'book') await loadAvailability();
      if (S.pick.id) await loadPick(S.pick.id);
      if (S.ctab === 'messages') S.data.messages = (await api('GET', '/api/messages')).messages;
    } else if (u.role === 'worker' && S.me.worker) {
      if (S.wtab === 'jobs') S.data.jobs = (await api('GET', '/api/worker/jobs')).jobs;
      if (['work', 'earn', 'support'].includes(S.wtab)) S.data.work = (await api('GET', '/api/worker/work')).work;
      if (S.wtab === 'avail') S.data.calendar = await api('GET', '/api/worker/calendar');
      if (S.wtab === 'level') S.data.ratings = await api('GET', '/api/worker/ratings');
      if (S.wtab === 'support') await loadSupport();
      if (S.wtab === 'messages') S.data.messages = (await api('GET', '/api/messages')).messages;
    }
  } catch (e) { toast(e.message); }
}
async function loadSupport() {
  S.data.reports = (await api('GET', '/api/reports/mine')).reports;
  S.data.blocks = (await api('GET', '/api/blocks')).blocks;
}
async function loadReg(id) { S.reg = { id, data: await api('GET', '/api/contractor/bookings/' + id + '/register') }; }
async function searchWorkers() {
  const f = S.ws, q = new URLSearchParams();
  ['skill', 'area', 'exp', 'minRating', 'maxWage', 'level'].forEach(k => { if (f[k] && f[k] !== 'any') q.set(k, f[k]); });
  if (f.start) { q.set('start', f.start); q.set('days', f.days); }
  if (f.verified) q.set('verified', '1'); if (f.fav) q.set('fav', '1');
  const r = await api('GET', '/api/contractor/workers?' + q.toString());
  f.results = r.workers; f.total = r.total;
}
async function loadAvailability() {
  const f = S.f; if (!f.start || f.start < istDate(0)) f.start = istDate(1);
  try { S.data.avail = (await api('GET', '/api/contractor/availability?start=' + encodeURIComponent(f.start) + '&days=' + f.days + '&level=' + f.level + (f.lat != null ? '&lat=' + f.lat + '&lng=' + f.lng : ''))).counts; } catch (e) { S.data.avail = {}; }
}
async function loadPick(id) {
  const r = await api('GET', '/api/contractor/bookings/' + id + '/available-workers');
  S.pick = { id, list: r.workers, needed: r.needed };
}
async function refresh() { await loadMe(); await loadTab(); render(); }

// ---------- payments ----------
let rzpLoading = null;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!rzpLoading) rzpLoading = new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = () => { rzpLoading = null; fail(new Error(t('networkError'))); }; document.head.appendChild(s); });
  return rzpLoading;
}
function pay(payment, description) {
  return new Promise((resolve) => {
    if (payment.mode === 'test') {
      showModal('<h2>' + esc(t('testPayTitle')) + '</h2><p style="margin:0">' + esc(t('testPayBody', { a: money(payment.amount) })) + '</p>' +
        '<button type="button" class="btn primary" data-a="testPay">' + esc(t('markPaid')) + ' · ' + money(payment.amount) + '</button>' +
        '<button type="button" class="btn ghost" data-a="closeModal">' + esc(t('cancel')) + '</button>');
      modalHandlers.testPay = async () => { try { await api('POST', '/api/payments/test-complete', { paymentId: payment.paymentId }); closeModal(); resolve(true); } catch (e) { toast(e.message); } };
      modalHandlers.closeModal = () => { closeModal(); resolve(false); };
      return;
    }
    loadCheckout().then(() => {
      const rz = new window.Razorpay(Object.assign({}, payment.checkout, {
        name: 'Labour Katta', description, theme: { color: '#E8A317' },
        handler: async (resp) => { try { await api('POST', '/api/payments/verify', resp); resolve(true); } catch (e) { toast(e.message); resolve(false); } },
        modal: { ondismiss: () => resolve(false) },
      }));
      rz.on('payment.failed', () => toast(t('payFailed')));
      rz.open();
    }).catch(e => { toast(e.message); resolve(false); });
  });
}
const modalHandlers = {};
function showModal(html) { document.getElementById('modal').innerHTML = '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>'; const b = document.querySelector('.modal button'); if (b) b.focus(); }
function closeModal() { document.getElementById('modal').innerHTML = ''; }

// ---------- pieces ----------
function tabs(list, cur, act) { return '<div class="tabs" role="tablist">' + list.map(x => '<button type="button" role="tab" data-a="' + act + '" data-v="' + x[0] + '" aria-selected="' + (cur === x[0]) + '">' + esc(x[1]) + '</button>').join('') + '</div>'; }
function seg(name, opts, cur) { return '<div class="chips">' + opts.map(o => '<button type="button" class="chip" data-a="set" data-k="' + name + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + esc(o[1]) + '</button>').join('') + '</div>'; }
function opt(act, k, v, on, title, sub) { return '<button type="button" class="opt" data-a="' + act + '" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + on + '"><span class="dot"></span><span><b>' + esc(title) + '</b>' + (sub ? '<br><span class="small">' + esc(sub) + '</span>' : '') + '</span></button>'; }
const empty = (msg) => '<div class="empty"><p style="margin:0">' + esc(msg) + '</p></div>';
const errBox = () => S.err ? '<div class="status s-err" role="alert">' + esc(S.err) + '</div>' : '';

function renderTop() {
  const u = S.me && S.me.user;
  const langs = [['en', 'EN'], ['hi', 'हिं'], ['mr', 'मरा']];
  const integ = S.me && S.me.integrations;
  const test = integ && (integ.payments === 'test' || integ.whatsapp === 'test');
  document.getElementById('top').innerHTML = '<header class="top"><div class="top-in">' +
    '<div class="brand"><div class="mark" aria-hidden="true">LK</div><b>Labour Katta</b></div>' +
    (u && isAdmin() ? '<div class="seg" role="group" aria-label="View"><button type="button" data-a="view" data-v="app" aria-pressed="' + (S.view !== 'admin') + '">' + esc(t('app')) + '</button><button type="button" data-a="view" data-v="admin" aria-pressed="' + (S.view === 'admin') + '">' + esc(t('admin')) + '</button></div>' : '') +
    '<div class="seg" role="group" aria-label="Language">' + langs.map(l => '<button type="button" data-a="lang" data-v="' + l[0] + '" aria-pressed="' + (S.lang === l[0]) + '">' + l[1] + '</button>').join('') + '</div>' +
    (u || isAdmin() ? '<button type="button" class="btn ghost small" data-a="logout">' + esc(t('signOut')) + '</button>' : '') +
    '</div>' + (u && u.actingAs ? '<div class="testbar"><span class="testpill" style="background:var(--blue-soft);color:var(--blue)">' + esc(t('adminViewing', { n: u.name || u.phone })) + '</span>&nbsp;<button type="button" class="btn ghost small" data-a="stopActing">' + esc(t('backToAdmin')) + '</button></div>' : '') +
    (test ? '<div class="testbar"><span class="testpill">● ' + esc(t('testMode')) + '</span></div>' : '') + '</header>';
  requestAnimationFrame(() => { const el = document.querySelector('.top'); if (el) document.documentElement.style.setProperty('--toph', el.offsetHeight + 'px'); });
}

// ---------- screens ----------
function phoneForm() {
  const L = S.login;
  if (!L.sent) {
    return '<label class="f" for="l-phone">' + esc(t('phoneLabel')) + '<input id="l-phone" class="in" type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" data-lf="phone" value="' + esc(L.phone) + '" placeholder="' + esc(t('phonePh')) + '"></label>' +
      errBox() + '<button type="button" class="btn primary" data-a="sendOtp">' + esc(t('sendCode')) + '</button>';
  }
  return '<p style="margin:0">' + esc(t('codeSent')) + '</p>' + (L.devCode ? '<div class="status s-warn">' + esc(t('testCode', { c: L.devCode })) + '</div>' : '') +
    '<label class="f" for="l-code">' + esc(t('codeLabel')) + '<input id="l-code" class="in num" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-lf="code" value="' + esc(L.code) + '"></label>' +
    errBox() + (L.unreg ? '<div class="signup"><button type="button" class="btn primary" data-a="verifyOtp" data-v="worker">👷 ' + esc(t('portalWorker')) + '</button><button type="button" class="btn primary" data-a="verifyOtp" data-v="contractor">🏗️ ' + esc(t('portalContractor')) + '</button></div>'
      : '<button type="button" class="btn primary" data-a="verifyOtp">' + esc(t('verify')) + '</button>') +
    '<div class="row"><button type="button" class="btn ghost small" data-a="changeNumber">' + esc(t('changeNumber')) + '</button><button type="button" class="btn ghost small" data-a="sendOtp">' + esc(t('resend')) + '</button></div>';
}
function renderLogin() {
  if (!S.portal || S.portal === 'login') {
    // Log in with a registered number: the number decides whether the worker or builder screen opens.
    const card = (v, ico, title, sub) => '<button type="button" class="opt" data-a="portal" data-v="' + v + '"><span class="ico" aria-hidden="true">' + ico + '</span><b>' + esc(title) + '</b><span class="small muted">' + esc(sub) + '</span></button>';
    return '<div class="login stack"><div class="landing-hero"><div class="row"><div class="mark" aria-hidden="true">LK</div><div><h1>Labour Katta</h1></div></div>' +
      '<span class="muted">' + esc(t('tagline')) + '</span>' +
      '<div class="trust"><div><b>✓</b>' + esc(t('trustVerified')) + '</div><div><b>₹</b>' + esc(t('trustPrice')) + '</div><div><b>💬</b>' + esc(t('trustWa')) + '</div></div></div>' +
      '<section class="card"><h2>' + esc(t('loginTitle')) + '</h2><span class="small muted">' + esc(t('loginSub')) + '</span>' + phoneForm() + '</section>' +
      '<div class="divider">' + esc(t('newHere')) + '</div>' +
      '<div class="signup">' + card('worker', '👷', t('portalWorker'), t('portalWorkerSub')) + card('contractor', '🏗️', t('portalContractor'), t('portalContractorSub')) + '</div>' +
      '<button type="button" class="opt partnercard" data-a="portal" data-v="partner"><span class="ico" aria-hidden="true">🧰</span><span><b>' + esc(t('portalPartner')) + '</b><br><span class="small muted">' + esc(t('portalPartnerSub')) + '</span></span></button>' +
      '<button type="button" class="btn ghost small" style="align-self:center" data-a="portal" data-v="admin">🔒 ' + esc(t('portalAdmin')) + '</button></div>';
  }
  let h = '<div class="login stack"><div class="row"><div class="mark" aria-hidden="true">LK</div><div><h1>Labour Katta</h1><span class="muted">' + esc(t('tagline')) + '</span></div></div>';
  const title = S.portal === 'admin' ? t('portalAdmin') : S.portal === 'worker' ? t('portalWorker') : S.portal === 'partner' ? t('portalPartner') : t('portalContractor');
  h += '<div class="row" style="justify-content:space-between"><h2>' + esc(title) + '</h2><button type="button" class="btn ghost small" data-a="portal" data-v="">← ' + esc(t('back')) + '</button></div><section class="card">';
  if (S.portal === 'admin') {
    h += '<label class="f" for="a-user">' + esc(t('username')) + '<input id="a-user" class="in" autocomplete="username" autocapitalize="off" data-af="user" value="' + esc(S.adm.user) + '"></label>' +
      '<label class="f" for="a-pass">' + esc(t('password')) + '<input id="a-pass" class="in" type="password" autocomplete="current-password" data-af="pass" value="' + esc(S.adm.pass) + '"></label>' +
      errBox() + '<button type="button" class="btn blue" data-a="adminLogin">' + esc(t('verify')) + '</button>';
  } else {
    h += '<span class="small muted">' + esc(t('signupSub')) + '</span>' + phoneForm();
  }
  return h + '</section></div>';
}
function renderRole() {
  return '<div class="login stack"><h1>' + esc(t('iAm')) + '</h1>' +
    opt('chooseRole', 'role', 'contractor', false, t('iAmContractor'), t('iAmContractorSub')) +
    opt('chooseRole', 'role', 'worker', false, t('iAmWorker'), t('iAmWorkerSub')) + errBox() + '</div>';
}
function renderContractorProfile() {
  return '<div class="login stack"><h1>' + esc(t('iAmContractor')) + '</h1><section class="card">' +
    '<div class="f"><span>' + esc(t('iAmA')) + '</span>' + seg('bizType', BIZ.map(b => [b, t('biz_' + b)]), S.f.bizType) + '</div>' +
    '<label class="f" for="c-name">' + esc(t('companyName')) + '<input id="c-name" class="in" data-f="company" value="' + esc(S.f.company) + '" maxlength="120"></label>' +
    '<label class="f" for="c-gst">' + esc(t('gst')) + '<input id="c-gst" class="in" data-f="gst" value="' + esc(S.f.gst) + '" maxlength="20"></label>' +
    '<label class="f" for="c-coupon">' + esc(t('couponLabel')) + '<input id="c-coupon" class="in" data-f="coupon" value="' + esc(S.f.coupon || '') + '" maxlength="40" autocapitalize="characters"></label>' +
    errBox() + '<button type="button" class="btn primary" data-a="saveContractor">' + esc(t('saveContinue')) + '</button></section></div>';
}
function renderWorkerProfile(editing) {
  const f = S.f, list = S.me.skills.filter(s => s.cat === f.wcat);
  return '<section class="card">' + (editing ? '<h2>' + esc(t('tProfile')) + '</h2>' : '<h1>' + esc(t('iAmWorker')) + '</h1>') +
    '<label class="f" for="w-name">' + esc(t('fullName')) + '<input id="w-name" class="in" data-f="wname" value="' + esc(f.wname) + '" maxlength="80" autocomplete="name"></label>' +
    '<label class="f" for="w-area">' + esc(t('area')) + '<input id="w-area" class="in" data-f="warea" value="' + esc(f.warea) + '" placeholder="' + esc(t('areaPh')) + '" maxlength="80"></label>' +
    '<b>' + esc(t('pickSkills')) + '</b>' + seg('wcat', [['skilled', t('skilled')], ['unskilled', t('unskilled')]], f.wcat) +
    '<div class="chips">' + list.map(s => '<button type="button" class="chip sk" data-a="wskill" data-v="' + esc(s.id) + '" aria-pressed="' + !!f.wskills[s.id] + '">' + esc(skillName(s)) + '</button>').join('') + '</div>' +
    '<div class="f"><span>' + esc(t('experience')) + '</span>' + seg('wexp', [['0-1', '0–1'], ['1-3', '1–3'], ['3-5', '3–5'], ['5+', '5+']], f.wexp) + '</div>' +
    '<label class="f" for="w-upi">' + esc(t('upi')) + '<input id="w-upi" class="in" data-f="wupi" value="' + esc(f.wupi) + '" placeholder="' + esc(t('upiPh')) + '" maxlength="80" autocapitalize="off"></label>' +
    (editing ? '' : '<label class="f" for="w-coupon">' + esc(t('couponLabel')) + '<input id="w-coupon" class="in" data-f="coupon" value="' + esc(f.coupon || '') + '" maxlength="40" autocapitalize="characters"></label>') +
    errBox() + '<button type="button" class="btn primary" data-a="saveWorker">' + esc(editing ? t('save') : t('saveContinue')) + '</button></section>';
}

// ----- contractor -----
function bookingLines() {
  return Object.keys(S.f.qty).filter(id => S.f.qty[id] > 0).map(id => ({ sk: S.me.skills.find(x => x.id === id), count: S.f.qty[id] })).filter(l => l.sk);
}
function quote() {
  const f = S.f, s = settings(), c = S.me.contractor, lines = bookingLines();
  if (!lines.length) return null;
  const bonus = f.level === 'gold' ? s.gold_bonus : f.level === 'silver' ? s.silver_bonus : 0;
  const qcCost = f.qc ? s.qc_per_day * f.days : 0;
  const jobFee = c && c.access ? 0 : s.job_fee;
  let work = 0, wagesYou = 0, skilled = 0, unskilled = 0;
  for (const l of lines) {
    const wage = l.sk.wage + bonus;
    work += (wage + s.margin_per_worker_day) * l.count * f.days;
    wagesYou += wage * l.count * f.days;
    if (l.sk.cat === 'skilled') skilled += l.count; else unskilled += l.count;
  }
  const workers = skilled + unskilled, platformFee = (s.platform_fee_per_worker || 0) * workers;
  const travel = n0(f.travel), travelTotal = travel * workers * f.days;
  const rows = lines.map(l => ({ label: l.count + ' × ' + skillName(l.sk), rate: l.sk.wage + bonus, amount: (l.sk.wage + bonus) * l.count * f.days }));
  const service = work - wagesYou;
  wagesYou += travelTotal;
  return { lines, rows, bonus, skilled, unskilled, workers, qcCost, jobFee, platformFee, travel, travelTotal, service, total: work + travelTotal + qcCost + jobFee + platformFee, feeNow: jobFee + qcCost + platformFee, wagesYou, wagesOnly: wagesYou - travelTotal };
}
// Google Maps helpers (no API key needed): embedded preview and a link that opens the Maps app.
function mapQuery(o) { return o.lat != null && o.lng != null ? o.lat + ',' + o.lng : (o.address || '').trim(); }
function mapsLink(o) { const q = mapQuery(o); return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : ''; }
function mapsDirections(o) { const q = mapQuery(o); return q ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) : ''; }
function mapEmbed(o, h) {
  const q = mapQuery(o); if (!q || q.length < 4) return '';
  return '<div style="border-radius:12px;overflow:hidden;border:1px solid var(--line)"><iframe title="' + esc(t('mapTitle')) + '" src="https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&z=16&output=embed" style="display:block;width:100%;height:' + (h || 220) + 'px;border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>';
}
function addressBlock(b, directions) {
  const o = { lat: b.site_lat, lng: b.site_lng, address: b.site_address };
  const link = directions ? mapsDirections(o) : mapsLink(o);
  if (!link) return '';
  return '<div class="row" style="gap:8px;align-items:flex-start"><span class="small grow">' + esc(b.site_address || t('pinnedLocation')) + '</span><a class="btn ghost small" href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(directions ? t('directions') : t('openMaps')) + '</a></div>';
}
// Verification badges: mobile is verified by the WhatsApp login code; the rest are checked by the Labour Katta team.
function vBadges(v) {
  if (!v) return '';
  return '<div class="badges">' + [['phone', 'vMobile'], ['id', 'vAadhaar'], ['photo', 'vPhoto'], ['bank', 'vBank'], ['skill', 'vTest']]
    .map(x => '<span class="vb ' + (v[x[0]] ? 'on' : '') + '">' + (v[x[0]] ? '✓ ' : '') + esc(t(x[1])) + '</span>').join('') + '</div>';
}
const fmtClock = (iso) => { try { return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
function statusPill(b) {
  const m = { pending_payment: ['p-red', 'stPending'], open: ['p-amber', 'stOpen'], assigned: ['p-green', 'stAssigned'], cancelled: ['p-grey', 'stCancelled'] }[b.status] || ['p-grey', b.status];
  return '<span class="pill ' + m[0] + '">' + esc(t(m[1])) + '</span>';
}
function bookingCard(b) {
  let h = '<section class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(b.count) + ' × ' + esc(bSkill(b)) + '</h3>' + statusPill(b) + '</div>' +
    '<span class="muted small">' + esc(b.site) + ' · ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' ' + esc(t('daysW')) + ' · ' + esc(t('reportBy', { t: b.report_time || '09:00' })) + ' · ' + esc(t('assignedOf', { a: b.team.length, n: b.count })) + '</span>' +
    addressBlock(b, false) +
    '<div class="kv small"><span>' + esc(b.pay_mode === 'lk' ? t('payLK') : t('payDirect')) + '</span><b class="num">' + money(b.amount_due) + '</b></div>';
  if (b.status === 'pending_payment') {
    const group = S.data.bookings.filter(x => x.group_id === b.group_id && x.status === 'pending_payment');
    if (group[0] && group[0].id === b.id) h += '<button type="button" class="btn primary" data-a="payBooking" data-b="' + esc(b.id) + '">' + esc(t('payPending')) + ' · ' + money(group.reduce((a, x) => a + x.amount_due, 0)) + '</button>';
  }
  if (b.status === 'open') {
    if (S.pick.id === b.id) {
      h += '<div class="stack" style="gap:8px;background:var(--sunk);border-radius:12px;padding:12px"><div class="row" style="justify-content:space-between"><b>' + esc(t('chooseWorkers')) + '</b><span class="pill p-blue">' + esc(t('needed', { n: S.pick.needed })) + '</span></div>' +
        pickFilterBar() + (pickFilter(S.pick.list).length ? '<div class="list">' + pickFilter(S.pick.list).map(w => workerMatchCard(w, '<button type="button" class="btn blue small" data-a="selectWorker" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '">' + esc(t('selectWorker')) + '</button>')).join('') + '</div>'
          : '<p class="small muted" style="margin:0">' + esc(t('noneAvailable')) + '</p>') +
        '<button type="button" class="btn ghost small" style="align-self:flex-start" data-a="hidePick">' + esc(t('hideWorkers')) + '</button></div>';
    } else {
      h += '<button type="button" class="btn blue" data-a="pickWorkers" data-b="' + esc(b.id) + '">' + esc(t('chooseWorkers')) + '</button>';
    }
  }
  h += asksBlock(b);
  if (b.team.length && b.status !== 'cancelled') {
    h += '<div><div class="row" style="justify-content:space-between"><b class="small">' + esc(t('attendance')) + ' · ' + esc(fmtDate(istDate(0))) + '</b>' +
      (b.wagesEarned != null ? '<span class="small muted">' + esc(t('wagesEarned')) + ' <b class="num">' + money(b.wagesEarned) + '</b></span>' : '') + '</div><div class="list">' + b.team.map(w => {
      return '<div class="li" style="flex-wrap:wrap"><div class="av" aria-hidden="true">' + esc(initials(w.name)) + '</div><div class="grow"><b>' + esc(w.name) + '</b> ' +
        (w.checkin ? '<span class="pill p-green">' + esc(t('reachedAt', { t: fmtClock(w.checkin) })) + '</span>' : '') +
        '<div class="small muted">' + esc(t(w.tier)) + ' · <a class="num" href="tel:+91' + esc(w.phone) + '">' + esc(w.phone) + '</a>' +
        (w.pay ? ' · ' + esc(t('daysWorked', { d: w.pay.payDays })) + ' · <b class="num">' + money(w.pay.earned) + '</b>' : '') + '</div>' + vBadges(w.v) + teamExtras(b, w) + '</div>' + favBtn(w.worker_id, w.favourite) +
        '<div class="chips att-row" role="group" aria-label="' + esc(t('attendance') + ' ' + w.name) + '">' + ['present', 'late', 'absent'].map(x => '<button type="button" class="chip" style="min-height:40px;font-size:14px" data-a="att" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '" data-v="' + x + '" aria-pressed="' + (w.today === x) + '">' + esc(t(x)) + '</button>').join('') + '</div>' +
        '<div class="row" style="gap:8px;flex-basis:100%;justify-content:flex-end">' + (w.today === 'absent' || (!w.confirmed_at && !b.started) ? '<button type="button" class="btn blue small" data-a="replace" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '">' + esc(t('replace')) + '</button>' : '') + blockBtn(w.worker_id) + '</div></div>';
    }).join('') + '</div></div>';
  }
  h += bookingPanels(b);
  if (b.status !== 'cancelled') {
    h += S.confirmCancel === b.id
      ? '<div class="row"><button type="button" class="btn danger small" data-a="cancelBooking" data-b="' + esc(b.id) + '">' + esc(t('confirmCancel')) + '</button><button type="button" class="btn ghost small" data-a="noCancel">' + esc(t('keep')) + '</button></div>'
      : '<button type="button" class="btn ghost small" style="align-self:flex-start" data-a="askCancel" data-b="' + esc(b.id) + '">' + esc(t('cancelBooking')) + '</button>';
  }
  return h + '</section>';
}
function qtySection(cat, title) {
  const f = S.f, list = S.me.skills.filter(s => s.cat === cat);
  const chosen = list.filter(s => f.qty[s.id] > 0);
  const total = chosen.reduce((a, s) => a + f.qty[s.id], 0);
  return '<section class="card"><div class="row" style="justify-content:space-between"><h2>' + esc(title) + '</h2><span class="pill ' + (total ? 'p-blue' : 'p-grey') + '">' + esc(t('workersCount', { n: total })) + '</span></div>' +
    '<span class="small muted">' + esc(t('tapToAdd')) + ' ' + esc(t('chipCountNote')) + '</span>' +
    '<div class="chips">' + list.map(s => '<button type="button" class="chip sk" data-a="addQty" data-v="' + esc(s.id) + '" aria-pressed="' + (f.qty[s.id] > 0) + '">' + esc(skillName(s)) + ' <span class="num" style="opacity:.7">· ' + (S.data.avail[s.id] || 0) + '</span></button>').join('') + '</div>' +
    (chosen.length ? '<div class="list">' + chosen.map(s => '<div class="li"><div class="grow"><b>' + esc(skillName(s)) + '</b><div class="small muted num">' + money((f.pay === 'lk' ? s.wage + settings().margin_per_worker_day : s.wage)) + ' ' + esc(t('perDay')) + '</div>' +
      '<div class="small num" style="color:' + ((S.data.avail[s.id] || 0) >= f.qty[s.id] ? 'var(--green-ink)' : 'var(--red-ink)') + '">' + esc(t('availableNow', { n: S.data.avail[s.id] || 0 })) + '</div></div>' +
      '<div class="stepper"><button type="button" data-a="qty" data-v="-1" data-k="' + esc(s.id) + '" aria-label="' + esc(skillName(s)) + ' −1">−</button><output class="num">' + f.qty[s.id] + '</output><button type="button" data-a="qty" data-v="1" data-k="' + esc(s.id) + '" aria-label="' + esc(skillName(s)) + ' +1">+</button></div></div>').join('') + '</div>' : '') +
    '</section>';
}
function renderBook() {
  const f = S.f;
  if (!f.start || f.start < istDate(0)) f.start = istDate(1);
  const q = quote();
  let h = qtySection('skilled', t('skilledWorkers')) + qtySection('unskilled', t('unskilledWorkers'));
  const pin = { lat: f.lat, lng: f.lng, address: f.siteAddress };
  h += '<section class="card"><h2>' + esc(t('siteTitle')) + '</h2>' +
    '<label class="f" for="b-site">' + esc(t('site')) + '<input id="b-site" class="in" data-f="site" value="' + esc(f.site) + '" placeholder="' + esc(t('sitePh')) + '" maxlength="160"></label>' +
    '<label class="f" for="b-addr">' + esc(t('siteAddress')) + '<input id="b-addr" class="in" data-f="siteAddress" value="' + esc(f.siteAddress) + '" placeholder="' + esc(t('siteAddressPh')) + '" maxlength="300" autocomplete="street-address"></label>' +
    '<div class="row"><button type="button" class="btn ghost small" data-a="locate">' + esc(f.lat != null ? t('pinUpdate') : t('useLocation')) + '</button>' +
    (f.lat != null ? '<span class="pill p-green num">' + esc(t('pinSet')) + '</span><button type="button" class="btn ghost small" data-a="clearPin">' + esc(t('clearPin')) + '</button>' : '') +
    (mapsLink(pin) ? '<a class="btn ghost small" href="' + esc(mapsLink(pin)) + '" target="_blank" rel="noopener">' + esc(t('openMaps')) + '</a>' : '') + '</div>' +
    mapEmbed(pin) + '</section>';
  h += '<section class="card"><div class="grid2"><label class="f" for="b-start">' + esc(t('startDate')) + '<input id="b-start" class="in" type="date" data-f="start" value="' + esc(f.start) + '" min="' + istDate(0) + '"></label>' +
    '<div class="f"><span>' + esc(t('days')) + '</span>' + seg('days', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [15, '15'], [30, '30']], f.days) + '</div></div>' +
    '<div class="f"><span>' + esc(t('level')) + '</span>' + seg('level', [['any', t('lvAny')], ['silver', t('lvSilver')], ['gold', t('lvGold')]], f.level) + '</div>' +
    '<span class="small muted">' + esc(t('levelShort')) + '</span>' +
    '<div class="grid2"><label class="f" for="b-rt">' + esc(t('reportTime')) + '<input id="b-rt" class="in" type="time" data-f="reportTime" value="' + esc(f.reportTime || '09:00') + '"></label>' +
    '<label class="f" for="b-ot">' + esc(t('otRateLbl')) + '<input id="b-ot" class="in num" type="number" min="0" data-f="otRate" value="' + esc(f.otRate) + '" placeholder="' + esc(t('otAuto', { m: settings().ot_multiplier || 2 })) + '"></label>' +
    '<label class="f" for="b-travel">' + esc(t('travelLbl')) + '<input id="b-travel" class="in num" type="number" min="0" max="2000" data-f="travel" value="' + esc(f.travel) + '" placeholder="0"></label></div>' +
    '<span class="small muted">' + esc(t('travelNote')) + '</span>' +
    (f.prefer.length ? '<div class="f"><span>' + esc(t('preferTitle')) + '</span><span class="small muted">' + esc(t('preferSub')) + '</span><div class="chips">' + f.prefer.map(p => '<button type="button" class="chip" data-a="removePrefer" data-v="' + esc(p.id) + '" aria-label="' + esc(t('remove') + ' ' + p.name) + '">' + esc(p.name) + ' ✕</button>').join('') + '</div></div>' : '') +
    '<button type="button" class="opt" data-a="toggle" data-k="qc" aria-pressed="' + f.qc + '"><span class="dot"></span><span><b>' + esc(t('addQc')) + '</b><br><span class="small muted num">' + money(settings().qc_per_day) + esc(t('perDayShort')) + '</span></span></button></section>';
  h += '<section class="card"><h2>' + esc(t('howPay')) + '</h2>' + opt('set', 'pay', 'lk', f.pay === 'lk', t('payLK'), t('payLKSub')) + opt('set', 'pay', 'direct', f.pay === 'direct', t('payDirect'), t('payDirectSub')) + '</section>';
  h += '<section class="card hero">';
  if (q) {
    h += '<div class="grid2"><div><span class="muted small">' + esc(t('skilledWorkers')) + '</span><div class="big num">' + q.skilled + '</div></div><div><span class="muted small">' + esc(t('unskilledWorkers')) + '</span><div class="big num">' + q.unskilled + '</div></div></div>' +
      '<div class="bill" role="table" aria-label="' + esc(t('costBreakdown')) + '"><div class="bill-h">' + esc(t('costBreakdown')) + ' · ' + f.days + ' ' + esc(t('daysW')) + '</div>' +
      q.rows.map(r => '<div class="bill-r"><span>' + esc(r.label) + ' <span class="muted num">@ ' + money(r.rate) + esc(t('perDayShort')) + '</span></span><span class="num">' + money(r.amount) + '</span></div>').join('') +
      '<div class="bill-r sub"><span>' + esc(t('bdWages')) + (f.pay === 'direct' ? ' · ' + esc(t('bdYouPay')) : '') + '</span><span class="num">' + money(q.wagesOnly) + '</span></div>' +
      (q.travelTotal ? '<div class="bill-r"><span>' + esc(t('bdTravel', { t: money(q.travel), n: q.workers, d: f.days })) + '</span><span class="num">' + money(q.travelTotal) + '</span></div>' : '') +
      (f.pay === 'lk' ? '<div class="bill-r"><span>' + esc(t('bdService')) + '</span><span class="num">' + money(q.service) + '</span></div>' : '') +
      (q.qcCost ? '<div class="bill-r"><span>' + esc(t('addQc')) + '</span><span class="num">' + money(q.qcCost) + '</span></div>' : '') +
      '<div class="bill-r"><span>' + esc(t('bdJobFee')) + '</span><span class="num">' + (q.jobFee ? money(q.jobFee) : esc(t('bdFree'))) + '</span></div>' +
      '<div class="bill-r"><span>' + esc(t('bdPlatform', { f: money(settings().platform_fee_per_worker), n: q.workers })) + '</span><span class="num">' + money(q.platformFee) + '</span></div>' +
      (f.pay === 'lk'
        ? '<div class="bill-r tot"><span>' + esc(t('payNow')) + '</span><span class="num">' + money(q.total) + '</span></div>'
        : '<div class="bill-r tot"><span>' + esc(t('payNow')) + '</span><span class="num">' + money(q.feeNow) + '</span></div><div class="bill-r"><span>' + esc(t('wagesYou')) + '</span><span class="num">' + money(q.wagesYou) + '</span></div>') +
      '</div><span class="small muted">' + esc(t('platformNote')) + '</span>' + termsTick('bterms') +
      errBox() + '<button type="button" class="btn primary wide" data-a="book"' + (S.busy || !S.f.bterms ? ' disabled' : '') + '>' + esc(t('confirm')) + '</button>';
  } else {
    h += '<span>' + esc(t('pickWorkersFirst')) + '</span>';
  }
  return h + '</section>';
}
function renderMessages() {
  const live = S.me.integrations.whatsapp === 'live';
  return '<section class="card"><h2>' + esc(t('waTitle')) + '</h2><p class="small muted" style="margin:0">' + esc(live ? t('waNoteLive') : t('waNoteTest')) + '</p>' +
    (S.data.messages.length ? S.data.messages.map(m => '<div class="msg"><div>' + esc(m.body) + '</div><div class="small muted num">' + esc(fmtTime(m.created_at)) + '</div></div>').join('') : '<p class="muted" style="margin:0">' + esc(t('noMessages')) + '</p>') + '</section>';
}
function couponBox(acct) {
  if (acct.coupon) return '<div class="status s-ok">' + esc(t('couponUsed', { c: acct.coupon.code, l: acct.coupon.label })) + '</div>';
  return '<div class="row" style="align-items:flex-end"><label class="f grow" for="cp-code">' + esc(t('haveCoupon')) + '<input id="cp-code" class="in" data-f="couponCode" value="' + esc(S.f.couponCode || '') + '" maxlength="40" autocapitalize="characters"></label>' +
    '<button type="button" class="btn ghost" data-a="applyCoupon">' + esc(t('applyCoupon')) + '</button></div>';
}
function renderActivate(c, s) {
  const p = money(c.planPrice);
  return '<div class="stack"><h1>' + esc(c.company) + '</h1>' +
    '<section class="card hero"><span class="small" style="color:var(--amber)">' + esc(t('activateTitle')) + '</span><span class="big num">' + p + '</span><span>' + esc(t('activateBody', { p })) + '</span></section>' +
    '<section class="card"><p style="margin:0">' + esc(t('planNoFee', { f: money(s.job_fee) })) + '</p>' +
    (c.custom_price != null ? '<div class="status s-ok">' + esc(t('specialPrice', { p })) + '</div>' : '') +
    (c.plan_status === 'trial' ? '<div class="status s-warn">' + esc(t('trialEnded')) + '</div>' : '') +
    couponBox(c) + errBox() + '<button type="button" class="btn primary" data-a="startPlan">' + esc(t('activateBtn', { p })) + '</button>' +
    '<span class="small muted">' + esc(t('offerNote')) + '</span></section></div>';
}
function renderContractor() {
  const c = S.me.contractor, s = settings();
  if (!c.access) return renderActivate(c, s);
  let h = '<div class="stack">' + tabs([['home', t('tHome')], ['book', t('tBook')], ['bookings', t('tBookings')], ['projects', t('tProjects')], ['workers', t('tFind')], ['plan', t('tPlan')], ['support', t('tHelp')], ['messages', t('tMessages')]], S.ctab, 'ctab');
  const live = S.data.bookings.filter(b => b.status !== 'cancelled');
  if (S.ctab === 'home') {
    if (c.plan_status === 'trial') h += '<div class="status s-ok">' + esc(t('trialUntil', { d: fmtDate(c.trial_until) })) + '</div>';
    h += '<div class="row" style="justify-content:space-between"><h1>' + esc(c.company) + '</h1>' + builderBadge(c.vflags) + '</div>' + renderDash() +
      '<button type="button" class="btn primary wide" data-a="ctab" data-v="book">+ ' + esc(t('tBook')) + '</button>' + live.slice(0, 3).map(bookingCard).join('');
  }
  if (S.ctab === 'book') h += renderBook();
  if (S.ctab === 'bookings') h += S.data.bookings.length ? S.data.bookings.map(bookingCard).join('') : empty(t('noBookings'));
  if (S.ctab === 'plan') {
    h += '<section class="card hero"><span class="small" style="color:var(--amber)">' + esc(t('planTitle')) + '</span><span class="big num">' + money(c.planPrice) + '</span><span>' + esc(t('planPrice', { p: money(c.planPrice) })) + '</span></section>' +
      '<section class="card"><p style="margin:0">' + esc(t('planNoFee', { f: money(s.job_fee) })) + '</p>' +
      (c.plan_status === 'trial' ? '<div class="status s-ok">' + esc(t('trialUntil', { d: fmtDate(c.trial_until) })) + '</div><button type="button" class="btn primary" data-a="startPlan">' + esc(t('startPlan')) + ' · ' + money(c.planPrice) + '</button>' :
       c.plan_status === 'active' ? '<div class="status s-ok">' + esc(t('planSince', { d: fmtDate(c.plan_since) })) + '</div><button type="button" class="btn danger" data-a="cancelPlan">' + esc(t('cancelPlan')) + '</button>'
        : (c.plan_status === 'cancelled' ? '<div class="status s-warn">' + esc(t('planCancelled')) + '</div>' : '') + '<button type="button" class="btn primary" data-a="startPlan">' + esc(t('startPlan')) + ' · ' + money(c.planPrice) + '</button>') + '</section>';
  }
  if (S.ctab === 'workers') h += renderFind();
  if (S.ctab === 'projects') h += renderClientProjects();
  if (S.ctab === 'support') h += renderSupport(S.data.bookings.filter(b => b.status !== 'pending_payment'));
  if (S.ctab === 'messages') h += renderMessages();
  return h + '</div>';
}

// ----- worker -----
function renderWorker() {
  const w = S.me.worker, s = settings();
  const v = [['vAadhaar', w.verified_aadhaar], ['vPhoto', w.verified_photo], ['vBank', w.verified_bank], ['vTest', w.verified_test]];
  let h = '<div class="stack"><section class="card hero"><div class="row"><div class="av" aria-hidden="true">' + esc(initials(w.name)) + '</div><div class="grow"><h2>' + esc(w.name) + '</h2><span class="muted small">' + esc(w.skills.map(id => skillName(S.me.skills.find(x => x.id === id))).join(', ')) + '</span></div><span class="pill p-amber">' + esc(t(w.tier)) + '</span></div></section>';
  h += tabs([['jobs', t('tJobs')], ['work', t('tWork')], ['avail', t('tAvail')], ['earn', t('tEarn')], ['level', t('tLevel')], ['member', t('tMember')], ['profile', t('tProfile')], ['support', t('tHelp')], ['messages', t('tMessages')]], S.wtab, 'wtab');
  const member = w.access;
  if (S.wtab === 'jobs' && member) {
    const st = w.avail_status || 'available';
    h += '<div class="row statusline"><span class="pill ' + (st === 'available' ? 'p-green' : st === 'busy' ? 'p-amber' : 'p-grey') + '">● ' + esc(st === 'busy' && w.busy_until ? t('busyUntilD', { d: fmtDate(w.busy_until) }) : t('st' + st[0].toUpperCase() + st.slice(1))) + '</span>' +
      '<button type="button" class="btn ghost small" data-a="wtab" data-v="avail">' + esc(t('changeAvail')) + '</button></div>';
  }
  if (S.wtab === 'jobs') {
    if (member && w.avail_status === 'unavailable') h += empty(t('notAvailableNote'));
    else if (!member) h += '<div class="empty"><p style="margin:0">' + esc(t('needMember')) + '</p><button type="button" class="btn primary" data-a="wtab" data-v="member">' + esc(t('startMem')) + '</button></div>';
    else h += (S.data.jobs.length ? '<section class="card">' + termsTick('wterms') + '</section>' : '') + (S.data.jobs.length ? S.data.jobs.map(b => '<section class="card offer"><h3>' + esc(bSkill(b)) + '</h3><span class="small">' + esc(b.site) + ' · ' + esc(t('starts')) + ' ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' ' + esc(t('daysW')) + '</span>' +
      '<div class="kv"><span class="big num">' + money(b.wage) + '<span class="small muted">' + esc(t('perDayShort')) + '</span></span><span class="pill p-blue">' + esc(t('needed', { n: b.needed })) + '</span></div>' +
      '<div class="row" style="gap:6px">' + builderBadge(b.builder) + '<span class="small">' + esc(b.company) + '</span>' + (b.distanceKm != null ? '<span class="pill p-blue">' + esc(t('kmAway', { d: b.distanceKm })) + '</span>' : '') + '</div>' +
      (b.travel_per_day ? '<span class="pill p-green" style="align-self:flex-start">+ ' + esc(t('travelPerDay', { t: money(b.travel_per_day) })) + '</span>' : '') +
      '<span class="small">' + esc(t('reportBy', { t: b.report_time || '09:00' })) + '</span>' +
      addressBlock(b, true) +
      '<span class="small" style="color:var(--green-ink)">' + esc(b.pay_mode === 'lk' ? t('paidLK') : t('paidDirect')) + '</span>' +
      askStatus(b) +
      '<button type="button" class="btn blue wide" data-a="accept" data-b="' + esc(b.id) + '"' + (S.f.wterms ? '' : ' disabled') + '>' + esc(t('accept')) + ' · ' + money(b.wage) + esc(t('perDayShort')) + '</button>' + askForm(b) + '<div class="row" style="justify-content:flex-end">' + blockBtn(b.contractor_id) + '</div></section>').join('') : empty(t('noJobs')));
  }
  if (S.wtab === 'work') {
    h += S.data.work.length ? S.data.work.map(b => '<section class="card"><h3>' + esc(bSkill(b)) + '</h3><span class="small muted">' + esc(b.site) + ' · ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' ' + esc(t('daysW')) + '</span>' +
      '<div class="kv small"><span>' + esc(t('contractorLbl')) + ': ' + esc(b.company) + '</span><span class="num">' + esc(b.contractor_phone) + '</span></div>' + addressBlock(b, true) +
      '<span class="small">' + esc(b.pay_mode === 'lk' ? t('paidLK') : t('paidDirect')) + '</span>' +
      workExtras(b) +
      (b.onSiteToday ? (b.checkin ? '<div class="status s-ok">' + esc(t('checkedInAt', { t: fmtClock(b.checkin) })) + (b.today ? ' · ' + esc(t('attMarked', { s: t(b.today) })) : ' · ' + esc(t('waitConfirm'))) + '</div>'
        : '<button type="button" class="btn primary wide" data-a="checkin" data-b="' + esc(b.id) + '">📍 ' + esc(t('iReached')) + '</button>') : '') +
      (b.pay ? '<div class="kv small"><span>' + esc(t('daysWorked', { d: b.pay.payDays })) + (b.pay.absent ? ' · ' + esc(t('absentN', { n: b.pay.absent })) : '') + '</span><b class="num">' + money(b.pay.earned) + '</b></div>' : '') +
      (S.confirmDecline === b.id ? '<div class="row"><button type="button" class="btn danger small" data-a="declineJob" data-b="' + esc(b.id) + '">' + esc(t('confirmCantGo')) + '</button><button type="button" class="btn ghost small" data-a="keepJob">' + esc(t('keepJob')) + '</button></div>'
        : (b.start_date >= istDate(0) ? '<button type="button" class="btn ghost small" style="align-self:flex-start" data-a="askDecline" data-b="' + esc(b.id) + '">' + esc(t('cantGo')) + '</button>' : '')) +
      (b.pay_mode === 'direct' ? (b.paid_confirmation ? '<div class="status ' + (b.paid_confirmation === 'yes' ? 's-ok' : 's-err') + '">' + esc(b.paid_confirmation === 'yes' ? t('saidYes') : t('saidNo')) + '</div>'
        : '<b class="small">' + esc(t('gotPaid')) + '</b><div class="grid2"><button type="button" class="btn danger small" data-a="paid" data-b="' + esc(b.id) + '" data-v="no">' + esc(t('no')) + '</button><button type="button" class="btn blue small" data-a="paid" data-b="' + esc(b.id) + '" data-v="yes">' + esc(t('yes')) + '</button></div>') : '') + '</section>').join('') : empty(t('noWork'));
  }
  if (S.wtab === 'earn') {
    const total = S.data.work.reduce((a, b) => a + (b.wage + (b.travel || 0)) * b.days, 0), earned = S.data.work.reduce((a, b) => a + (b.pay ? b.pay.earned : 0), 0);
    h += '<div class="grid2"><section class="card hero"><span class="muted small">' + esc(t('earnedSoFar')) + '</span><span class="big num">' + money(earned) + '</span><span class="small muted">' + esc(t('earnedNote')) + '</span></section>' +
      '<section class="card"><span class="muted small">' + esc(t('totalEarn')) + '</span><span class="big num">' + money(total) + '</span></section></div>' +
      '<section class="card"><div class="list">' + (S.data.work.length ? S.data.work.map(b => '<div class="li"><div class="grow"><b>' + esc(bSkill(b)) + '</b><div class="small muted">' + esc(b.site) + ' · ' + esc(t('daysWorked', { d: b.pay ? b.pay.payDays : 0 })) + ' / ' + esc(b.days) + ' × ' + money(b.wage) + '</div></div><b class="num">' + money(b.pay ? b.pay.earned : 0) + '</b></div>').join('') : '<p class="muted" style="margin:0">' + esc(t('noWork')) + '</p>') + '</div></section>';
  }
  if (S.wtab === 'member') {
    if (w.membership_status === 'trial' && member) h += '<section class="card"><div class="status s-ok">' + esc(t('trialUntil', { d: fmtDate(w.trial_until) })) + '</div><span class="small muted">' + esc(t('trialKeep')) + '</span></section>';
    if (w.membership_status === 'active') h += '<section class="card"><div class="status s-ok">' + esc(t('memOn')) + ' · ' + esc(w.membership_method === 'cash' ? t('memCash') : t('memUpi')) + ' · ' + esc(fmtDate(w.membership_since)) + '</div><button type="button" class="btn danger" data-a="cancelMem">' + esc(t('cancelMem')) + '</button></section>';
    else if (w.membership_status === 'pending_cash') h += '<section class="card"><div class="status s-warn">' + esc(t('memPendingCash', { c: money(w.cashPrice) })) + '</div></section>';
    else {
      const upi = S.f.memMethod === 'upi';
      h += '<section class="card hero"><span class="small" style="color:var(--amber)">' + esc(t('memTitle')) + '</span><span class="big num">' + money(upi ? Math.min(s.worker_first_month, w.monthlyPrice) : w.cashPrice) + '</span><span>' + esc(upi ? t('memUpiSub', { a: money(Math.min(s.worker_first_month, w.monthlyPrice)), m: money(w.monthlyPrice) }) : t('memCashSub', { c: money(w.cashPrice) })) + '</span></section>' +
        '<section class="card"><span class="pill p-grey" style="align-self:flex-start">' + esc(t('memOff')) + '</span>' +
        opt('set', 'memMethod', 'upi', upi, t('memUpi'), t('memUpiSub', { a: money(Math.min(s.worker_first_month, w.monthlyPrice)), m: money(w.monthlyPrice) })) +
        opt('set', 'memMethod', 'cash', !upi, t('memCash'), t('memCashSub', { c: money(w.cashPrice) })) +
        couponBox(w) + '<button type="button" class="btn primary" data-a="startMem">' + esc(t('startMem')) + '</button></section>';
    }
  }
  if (S.wtab === 'avail') h += availControl(w) + renderCalendar() + travelControl(w);
  if (S.wtab === 'level') h += renderLevel(w);
  if (S.wtab === 'support') h += renderSupport(S.data.work);
  if (S.wtab === 'profile') {
    h += renderWorkerProfile(true) + '<section class="card"><h2>' + esc(t('verifyTitle')) + '</h2><div class="list">' + v.map(x => '<div class="li"><div class="grow"><b>' + esc(t(x[0])) + '</b></div><span class="pill ' + (x[1] ? 'p-green' : 'p-amber') + '">' + esc(x[1] ? t('vDone') : t('vPending')) + '</span></div>').join('') + '</div></section>';
  }
  if (S.wtab === 'messages') h += renderMessages();
  return h + '</div>';
}

// ----- admin -----
const CFG = [
  ['worker_first_month', 'Worker – first month (UPI AutoPay)'], ['worker_monthly', 'Worker – monthly (UPI AutoPay)'], ['worker_cash_monthly', 'Worker – monthly (cash)'],
  ['contractor_plan', 'Builder plan – monthly'], ['platform_fee_per_worker', 'Platform fee – per worker, every booking'], ['job_fee', 'Job fee – builder without plan'],
  ['ot_multiplier', 'Overtime multiplier (× hourly wage) when no rate is agreed'], ['reminder_hour', 'Reminder to workers – hour of day before job (0–23)'], ['confirm_hours_before', 'Alert builder if not confirmed – hours before reporting'],
  ['project_inspection_fee', 'Projects – inspection (quality) charge per award'], ['project_platform_fee', 'Projects – platform fee per award'], ['partner_leads_verified_only', 'Projects – send leads only to verified contractors (1 = yes, 0 = no)'],
  ['qc_per_day', 'Quality In-charge – per day'], ['margin_per_worker_day', 'Labour Katta margin – per worker per day'], ['silver_bonus', 'Silver tier bonus – per day'], ['gold_bonus', 'Gold tier bonus – per day']];
const PERM_LABELS = { bookings: 'Bookings', workers: 'Workers', builders: 'Builders', pricing: 'Prices & skills', coupons: 'Coupons', payments: 'Payments & messages', open_portals: 'Open portals', disputes: 'Reports, disputes & builder verification', projects: 'Projects marketplace & inspections' };
function adminInfo() { return (S.me && S.me.admin) || { root: false, perms: [], name: '' }; }
function canDo(p) { const a = adminInfo(); return a.root || a.perms.includes(p); }
function adminTabs() {
  const a = adminInfo(), list = [['overview', 'Overview']];
  if (a.staffId) list.push(['mywork', 'My workload'], ['myinsp', 'My inspections' + (S.admin.overview && S.admin.overview.myInspections ? ' (' + S.admin.overview.myInspections + ')' : '')]);
  if (canDo('projects')) list.push(['mprojects', 'Projects'], ['partners', 'Contractors & pros'], ['categories', 'Categories']);
  if (canDo('bookings')) list.push(['bookings', 'Bookings']);
  if (canDo('workers')) list.push(['workers', 'Workers']);
  if (canDo('builders')) list.push(['contractors', 'Builders']);
  if (canDo('pricing')) list.push(['pricing', 'Prices & fees'], ['skills', 'Skills & rates']);
  if (canDo('disputes')) list.push(['reports', 'Reports & disputes' + (S.admin.overview && S.admin.overview.openReports ? ' (' + S.admin.overview.openReports + ')' : '')]);
  if (canDo('coupons')) list.push(['coupons', 'Coupons']);
  if (canDo('payments')) list.push(['payments', 'Payments'], ['outbox', 'WhatsApp outbox']);
  if (a.root) list.push(['staff', 'Supervisors']);
  return list;
}
const P = (path, value, attrs) => 'data-p="' + path + '" value="' + esc(value == null ? '' : value) + '"' + (attrs ? ' ' + attrs : '');
function skillChips(path, chosen, cat) {
  return '<div class="chips">' + (S.me.skills || []).filter(x => !cat || x.cat === cat).map(x => '<button type="button" class="chip sk" data-a="toggleSkill" data-k="' + path + '" data-v="' + esc(x.id) + '" aria-pressed="' + !!chosen[x.id] + '" style="min-height:36px;font-size:13px">' + esc(x.en) + '</button>').join('') + '</div>';
}
const EXP_OPTS = [['', '—'], ['0-1', '0–1 yrs'], ['1-3', '1–3 yrs'], ['3-5', '3–5 yrs'], ['5+', '5+ yrs']];
const sel = (path, value, opts, label) => '<select class="in sm" aria-label="' + esc(label) + '" data-p="' + path + '">' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
const confirmBtn = (key, act, v, label) => S.confirmDelUser === key
  ? '<button type="button" class="btn danger small" data-a="' + act + '" data-v="' + esc(v) + '">Confirm ' + esc(label.toLowerCase()) + '</button> <button type="button" class="btn ghost small" data-a="noDelUser">Keep</button>'
  : '<button type="button" class="btn danger small" data-a="askDelUser" data-v="' + esc(key) + '">' + esc(label) + '</button>';
const matchQ = (...vals) => { const q = (S.q || '').trim().toLowerCase(); return !q || vals.some(v => String(v || '').toLowerCase().includes(q)); };

function renderAdmin() {
  const A = S.admin, me = adminInfo(), list = adminTabs();
  if (!list.find(x => x[0] === S.atab)) S.atab = 'overview';
  let h = '<div class="stack"><div class="row" style="justify-content:space-between"><h1>' + (me.root ? 'Admin' : 'Supervisor') + '</h1><span class="small muted">Signed in as ' + esc(me.name || 'Admin') + (me.group ? ' · ' + esc(me.group) : '') + '</span></div>' + tabs(list, S.atab, 'atab');

  if (S.atab === 'overview' && A.overview) {
    const o = A.overview;
    const tiles = [['Workers', o.workers], ['Active members', o.activeMembers], ['Cash payments to collect', o.pendingCash], ['Builders', o.contractors], ['Active builder plans', o.activePlans], ['Bookings finding workers', o.openBookings], ['Real payments received', money(o.paidTotal)]];
    if (o.myWorkload != null) tiles.unshift(['My sites to supervise', o.myWorkload]);
    if (o.urgentReports) h += '<div class="status s-err">' + o.urgentReports + ' urgent report(s) waiting. ' + (canDo('disputes') ? 'Open Reports & disputes.' : '') + '</div>';
    if (o.today) {
      const d = o.today;
      h += '<section class="card"><h2>Today\'s site summary</h2><div class="stats">' + [['Sites with active bookings', d.sites], ['Workers expected', d.expected], ['Present', d.present + d.late], ['Absent', d.absent], ['Checked in, not marked', d.checkedIn], ['Not yet checked in', d.notCheckedIn]]
        .map(x => '<div class="stat"><b class="num">' + x[1] + '</b><span>' + esc(x[0]) + '</span></div>').join('') + '</div></section>';
    }
    tiles.push(['Open reports & disputes', o.openReports || 0]);
    if (o.partners != null) tiles.push(['Contractors & professionals', o.partners], ['Open projects', o.openProjects], ['Projects awarded', o.awardedProjects], ['Project fees received', money(o.projectFeesEarned)]);
    if (o.myInspections != null) tiles.unshift(['My inspections to do', o.myInspections]);
    h += '<div class="grid3">' + tiles.map(x => '<section class="card"><span class="small muted">' + esc(x[0]) + '</span><span class="big num">' + esc(x[1]) + '</span></section>').join('') + '</div>';
    if (me.root) h += '<section class="card"><h2>Integrations</h2><div class="list">' +
      [['Razorpay payments & UPI AutoPay', o.integrations.payments], ['WhatsApp Cloud API', o.integrations.whatsapp], ['Razorpay webhook secret', o.integrations.webhookSecret ? 'live' : 'test']]
        .map(x => '<div class="li"><div class="grow"><b>' + esc(x[0]) + '</b></div><span class="pill ' + (x[1] === 'live' ? 'p-green' : 'p-amber') + '">' + (x[1] === 'live' ? 'Connected' : 'Test mode') + '</span></div>').join('') +
      '</div><span class="small muted">Keys are set as environment variables on the server. See the README.</span></section>';
  }

  if (S.atab === 'mywork' && A['my-work']) {
    const bk = A['my-work'].bookings;
    h += bk.length ? bk.map(b => '<section class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(b.count) + ' × ' + esc(b.skill_en) + '</h3>' + statusPill(b) + '</div>' +
      '<span class="small muted">' + esc(b.company) + ' · <span class="num">' + esc(b.builder_phone) + '</span> · ' + esc(b.site) + ' · ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' days</span>' + addressBlock(b, true) +
      (b.team.length ? '<div class="list">' + b.team.map(w => '<div class="li" style="flex-wrap:wrap"><div class="grow"><b>' + esc(w.name) + '</b> <span class="small muted num">' + esc(w.phone) + '</span>' + (w.checkin ? ' <span class="pill p-green">Reached ' + esc(fmtClock(w.checkin)) + '</span>' : '') + '</div>' +
        '<div class="chips">' + ['present', 'late', 'absent'].map(x => '<button type="button" class="chip" style="min-height:36px;font-size:13px" data-a="supAtt" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '" data-v="' + x + '" aria-pressed="' + (w.today === x) + '">' + x[0].toUpperCase() + x.slice(1) + '</button>').join('') + '</div></div>').join('') + '</div>'
        : '<span class="small muted">No workers assigned yet.</span>') +
      '<div class="row" style="align-items:flex-end"><label class="f grow" for="sn-' + esc(b.id) + '">Urgent message to all workers on this site<input id="sn-' + esc(b.id) + '" class="in sm" maxlength="300" placeholder="e.g. Site closed tomorrow because of rain"></label><button type="button" class="btn danger small" data-a="supNotice" data-v="' + esc(b.id) + '">Send</button></div>' + '</section>').join('') : empty('No sites are assigned to you yet. The admin assigns bookings from the Bookings tab.');
  }

  if (S.atab === 'pricing' && A.settings) {
    const d = S.cfgDraft || A.settings;
    h += '<section class="card"><h2>Prices & fees</h2><span class="small muted">All amounts in ₹. New prices apply to new bookings and new subscriptions. The platform fee is charged on every booking, per worker, even when the builder pays workers directly.</span><div class="grid3">' +
      CFG.map(c => '<label class="f" for="cfg-' + c[0] + '">' + esc(c[1]) + '<input id="cfg-' + c[0] + '" class="in num" type="number" min="0" inputmode="numeric" data-cfg="' + c[0] + '" value="' + esc(d[c[0]]) + '"></label>').join('') + '</div>' +
      '<div class="row"><button type="button" class="btn blue" data-a="saveCfg">Save prices</button>' + (S.cfgDraft ? '<span class="pill p-amber">Unsaved changes</span>' : '') + '</div></section>';
  }

  if (S.atab === 'skills' && A.skills) {
    const margin = settings().margin_per_worker_day;
    h += '<section class="card"><h2>Skills & daily rates</h2><span class="small muted">' + A.skills.length + ' skills. Edit a field, then press Enter or move to the next field to save. Builder price = wage + ' + money(margin) + ' margin.</span>' +
      '<div class="tablebox"><table><thead><tr><th>English</th><th>Hindi</th><th>Marathi</th><th>Type</th><th>Wage / day (₹)</th><th>Builder price</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' +
      A.skills.map(x => '<tr><td><input class="in sm" style="min-width:160px" aria-label="English name" data-sk="' + esc(x.id) + '" data-fld="en" value="' + esc(x.en) + '"></td>' +
        '<td><input class="in sm" style="min-width:140px" aria-label="Hindi name for ' + esc(x.en) + '" data-sk="' + esc(x.id) + '" data-fld="hi" value="' + esc(x.hi) + '"></td>' +
        '<td><input class="in sm" style="min-width:140px" aria-label="Marathi name for ' + esc(x.en) + '" data-sk="' + esc(x.id) + '" data-fld="mr" value="' + esc(x.mr) + '"></td>' +
        '<td><select class="in sm" aria-label="Type for ' + esc(x.en) + '" data-sk="' + esc(x.id) + '" data-fld="cat"><option value="skilled"' + (x.cat === 'skilled' ? ' selected' : '') + '>Skilled</option><option value="unskilled"' + (x.cat === 'unskilled' ? ' selected' : '') + '>Unskilled</option></select></td>' +
        '<td><input class="in sm num" style="width:100px" type="number" min="1" aria-label="Wage for ' + esc(x.en) + '" data-sk="' + esc(x.id) + '" data-fld="wage" value="' + esc(x.wage) + '"></td>' +
        '<td class="num"><b>' + money(x.wage + margin) + '</b></td><td style="text-align:right;white-space:nowrap">' +
        (S.confirmDel === x.id ? '<button type="button" class="btn danger small" data-a="delSkill" data-v="' + esc(x.id) + '">Confirm remove</button> <button type="button" class="btn ghost small" data-a="noDel">Keep</button>' : '<button type="button" class="btn danger small" data-a="askDel" data-v="' + esc(x.id) + '">Remove</button>') + '</td></tr>').join('') +
      '</tbody></table></div><h3>Add a skill</h3><div class="grid3">' +
      '<label class="f" for="ns-en">English name<input id="ns-en" class="in" data-f="newEn" value="' + esc(S.f.newEn) + '" placeholder="e.g. Scaffolding fitter"></label>' +
      '<label class="f" for="ns-hi">Hindi name<input id="ns-hi" class="in" data-f="newHi" value="' + esc(S.f.newHi) + '"></label>' +
      '<label class="f" for="ns-mr">Marathi name<input id="ns-mr" class="in" data-f="newMr" value="' + esc(S.f.newMr) + '"></label>' +
      '<label class="f" for="ns-cat">Type<select id="ns-cat" class="in" data-f="newCat"><option value="skilled"' + (S.f.newCat === 'skilled' ? ' selected' : '') + '>Skilled</option><option value="unskilled"' + (S.f.newCat === 'unskilled' ? ' selected' : '') + '>Unskilled</option></select></label>' +
      '<label class="f" for="ns-wage">Wage / day (₹)<input id="ns-wage" class="in num" type="number" min="1" data-f="newWage" value="' + esc(S.f.newWage) + '" placeholder="900"></label>' +
      '<div class="f" style="justify-content:flex-end"><button type="button" class="btn primary" data-a="addSkill">Add skill</button></div></div>' + errBox() + '</section>';
  }

  if (S.atab === 'workers' && A.workers) {
    const sk = A.skills || [], aw = S.f.aw, open = canDo('open_portals');
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>Add a worker</h2><button type="button" class="btn ghost small" data-a="toggleForm" data-v="aw">' + (S.formOpen.aw ? 'Close' : 'Add worker') + '</button></div>' +
      (S.formOpen.aw ? '<div class="grid3">' +
        '<label class="f" for="aw-phone">Mobile number<input id="aw-phone" class="in" type="tel" inputmode="numeric" ' + P('f.aw.phone', aw.phone) + '></label>' +
        '<label class="f" for="aw-name">Full name<input id="aw-name" class="in" ' + P('f.aw.name', aw.name) + '></label>' +
        '<label class="f" for="aw-area">Area<input id="aw-area" class="in" ' + P('f.aw.area', aw.area) + '></label>' +
        '<label class="f">Experience' + sel('f.aw.experience', aw.experience, EXP_OPTS, 'Experience') + '</label>' +
        '<label class="f" for="aw-coupon">Coupon code (optional)<input id="aw-coupon" class="in" ' + P('f.aw.coupon', aw.coupon) + '></label></div>' +
        '<b class="small">Skilled</b>' + skillChips('f.aw.skills', aw.skills, 'skilled') + '<b class="small">Unskilled</b>' + skillChips('f.aw.skills', aw.skills, 'unskilled') +
        errBox() + '<button type="button" class="btn primary" style="align-self:flex-start" data-a="addWorker">Add worker</button>' : '') + '</section>';
    const rows = A.workers.filter(w => matchQ(w.name, w.phone, w.area));
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>Workers (' + A.workers.length + ')</h2><input id="q-workers" class="in sm" style="max-width:260px" placeholder="Search name, phone, area" ' + P('q', S.q) + '></div>' +
      '<span class="small muted">Levels are earned automatically: Silver = Aadhaar + photo checked and profile complete; Gold = Silver + skill test + 5 completed jobs + 85% reliability + 4★ (if rated). You can only cap a level lower. Tick verifications after checking documents. Custom wage overrides the skill rate + tier bonus for that worker.</span><div class="tablebox"><table><thead><tr><th>Worker</th><th>Skills</th><th>Aadhaar</th><th>Photo</th><th>Bank</th><th>Skill test</th><th>Membership</th><th>Free trial</th><th>Special price (₹/month)</th><th>Level</th><th>Custom wage (₹)</th><th>Actions</th></tr></thead><tbody>' +
      (rows.length ? rows.map(w => {
        let row = '<tr><td><b>' + esc(w.name) + '</b><div class="small muted num">' + esc(w.phone) + (w.area ? ' · ' + esc(w.area) : '') + (w.coupon ? ' · coupon ' + esc(w.coupon) : '') + (w.avail_status && w.avail_status !== 'available' ? ' · ' + esc(w.avail_status) : '') + '</div><div class="small muted">' + esc(relLine(w.reliability, w.rating)) + '</div></td>' +
          '<td class="small">' + esc(w.skills.map(id => (sk.find(x => x.id === id) || {}).en || '—').join(', ')) + '</td>' +
          ['verified_aadhaar', 'verified_photo', 'verified_bank', 'verified_test'].map(k => '<td><input type="checkbox" style="width:22px;height:22px" aria-label="' + k.replace('verified_', '') + ' verified for ' + esc(w.name) + '" data-wk="' + esc(w.user_id) + '" data-fld="' + k + '"' + (w[k] ? ' checked' : '') + '></td>').join('') +
          '<td>' + (w.membership_status === 'active' ? '<span class="pill p-green">Active · ' + (w.membership_method === 'cash' ? 'Cash' : 'AutoPay') + '</span>'
            : w.membership_status === 'trial' ? '<span class="pill p-blue">Trial to ' + esc(fmtDate(w.trial_until)) + '</span>'
            : w.membership_status === 'pending_cash' ? '<button type="button" class="btn primary small" data-a="cashReceived" data-v="' + esc(w.user_id) + '">Cash received</button>' : '<span class="pill p-grey">Not paid</span>') + '</td>' +
          '<td style="white-space:nowrap">' + (w.membership_status === 'active' ? '—' : '<input id="trial-' + esc(w.user_id) + '" class="in sm num" style="width:64px" type="number" min="1" max="365" value="30" aria-label="Trial days for ' + esc(w.name) + '"> <button type="button" class="btn ghost small" data-a="trialW" data-v="' + esc(w.user_id) + '">Give days</button>') + '</td>' +
          '<td><input class="in sm num" style="width:100px" type="number" min="1" placeholder="Standard" aria-label="Special price for ' + esc(w.name) + '" data-wp="' + esc(w.user_id) + '" value="' + esc(w.custom_price == null ? '' : w.custom_price) + '"></td>' +
          '<td style="white-space:nowrap"><span class="pill ' + (w.tier === 'gold' ? 'p-amber' : w.tier === 'silver' ? 'p-blue' : 'p-grey') + '">' + esc(w.tier) + '</span><div class="small muted">Earned: ' + esc(w.computedTier || w.tier) + '</div>' +
            '<select class="in sm" aria-label="Highest level allowed for ' + esc(w.name) + '" data-wk="' + esc(w.user_id) + '" data-fld="tier_cap">' + [['gold', 'Max: Gold'], ['silver', 'Max: Silver'], ['bronze', 'Max: Bronze']].map(x => '<option value="' + x[0] + '"' + ((w.tier_cap || 'gold') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></td>' +
          '<td><input class="in sm num" style="width:100px" type="number" min="1" placeholder="—" aria-label="Custom wage for ' + esc(w.name) + '" data-wk="' + esc(w.user_id) + '" data-fld="custom_wage" value="' + esc(w.custom_wage == null ? '' : w.custom_wage) + '"></td>' +
          '<td style="white-space:nowrap"><button type="button" class="btn ghost small" data-a="editWorker" data-v="' + esc(w.user_id) + '">Edit</button> ' + (open ? '<button type="button" class="btn blue small" data-a="actAs" data-v="' + esc(w.user_id) + '">Open</button> ' : '') + confirmBtn('w:' + w.user_id, 'delWorker', w.user_id, 'Delete') + '</td></tr>';
        if (S.edit && S.edit.id === w.user_id) {
          const e = S.edit;
          row += '<tr><td colspan="12" style="background:var(--sunk)"><div class="stack" style="gap:10px"><div class="grid3">' +
            '<label class="f" for="ew-name">Full name<input id="ew-name" class="in sm" ' + P('edit.name', e.name) + '></label>' +
            '<label class="f" for="ew-phone">Mobile number<input id="ew-phone" class="in sm" type="tel" ' + P('edit.phone', e.phone) + '></label>' +
            '<label class="f" for="ew-area">Area<input id="ew-area" class="in sm" ' + P('edit.area', e.area) + '></label>' +
            '<label class="f">Experience' + sel('edit.experience', e.experience, EXP_OPTS, 'Experience') + '</label></div>' +
            '<b class="small">Skills</b>' + skillChips('edit.skills', e.skills) +
            '<div class="row"><button type="button" class="btn blue small" data-a="saveEditWorker">Save changes</button><button type="button" class="btn ghost small" data-a="cancelEdit">Cancel</button></div></div></td></tr>';
        }
        return row;
      }).join('') : '<tr><td colspan="12" class="muted">No workers found.</td></tr>') + '</tbody></table></div></section>';
  }

  if (S.atab === 'contractors' && A.contractors) {
    const ab = S.f.ab, open = canDo('open_portals');
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>Add a builder</h2><button type="button" class="btn ghost small" data-a="toggleForm" data-v="ab">' + (S.formOpen.ab ? 'Close' : 'Add builder') + '</button></div>' +
      (S.formOpen.ab ? '<div class="grid3">' +
        '<label class="f" for="ab-phone">Mobile number<input id="ab-phone" class="in" type="tel" inputmode="numeric" ' + P('f.ab.phone', ab.phone) + '></label>' +
        '<label class="f" for="ab-company">Company name<input id="ab-company" class="in" ' + P('f.ab.company', ab.company) + '></label>' +
        '<label class="f" for="ab-gst">GST number (optional)<input id="ab-gst" class="in" ' + P('f.ab.gst', ab.gst) + '></label>' +
        '<label class="f" for="ab-coupon">Coupon code (optional)<input id="ab-coupon" class="in" ' + P('f.ab.coupon', ab.coupon) + '></label></div>' +
        errBox() + '<button type="button" class="btn primary" style="align-self:flex-start" data-a="addBuilder">Add builder</button>' : '') + '</section>';
    const rows = A.contractors.filter(c => matchQ(c.company, c.phone, c.gst));
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>Builders (' + A.contractors.length + ')</h2><input id="q-builders" class="in sm" style="max-width:260px" placeholder="Search company, phone, GST" ' + P('q', S.q) + '></div>' +
      '<span class="small muted">A builder is shown to workers as "Verified" when ID/KYC is checked plus GST or a site visit. Builders must pay the monthly plan before they can book or get messages. Give a free trial or a special price here.</span><div class="tablebox"><table><thead><tr><th>Company</th><th>Phone</th><th>Verified</th><th>Plan</th><th>Free trial</th><th>Special price (₹/month)</th><th>Joined</th><th>Actions</th></tr></thead><tbody>' +
      (rows.length ? rows.map(c => {
        let row = '<tr><td><b>' + esc(c.company) + '</b><div class="small muted">' + esc(c.gst || '') + (c.coupon ? ' · coupon ' + esc(c.coupon) : '') + '</div></td><td class="num">' + esc(c.phone) + '</td>' +
          '<td style="white-space:nowrap">' + (c.vflags && c.vflags.verified ? '<span class="pill p-green">Verified builder</span>' : '<span class="pill p-grey">Not verified</span>') +
            [['verified_id', 'ID / KYC'], ['verified_gst', 'GST'], ['verified_site', 'Site visit']].map(x => '<label class="row small" style="gap:6px"><input type="checkbox" style="width:20px;height:20px" data-cv="' + esc(c.user_id) + '" data-fld="' + x[0] + '"' + (c[x[0]] ? ' checked' : '') + (canDo('disputes') || canDo('builders') ? '' : ' disabled') + '> ' + x[1] + '</label>').join('') +
            (c.reportsAgainst ? '<span class="pill p-red">' + c.reportsAgainst + ' open report(s)</span>' : '') + '</td>' +
          '<td>' + (c.plan_status === 'active' ? '<span class="pill p-green">Paid</span>' : c.plan_status === 'trial' ? '<span class="pill p-blue">Trial to ' + esc(fmtDate(c.trial_until)) + '</span>' : '<span class="pill p-grey">Not paid</span>') + '</td>' +
          '<td style="white-space:nowrap">' + (c.plan_status === 'active' ? '—' : '<input id="trial-' + esc(c.user_id) + '" class="in sm num" style="width:64px" type="number" min="1" max="365" value="30" aria-label="Trial days for ' + esc(c.company) + '"> <button type="button" class="btn ghost small" data-a="trialC" data-v="' + esc(c.user_id) + '">Give days</button>') + '</td>' +
          '<td><input class="in sm num" style="width:100px" type="number" min="1" placeholder="Standard" aria-label="Special price for ' + esc(c.company) + '" data-cp="' + esc(c.user_id) + '" value="' + esc(c.custom_price == null ? '' : c.custom_price) + '"></td>' +
          '<td class="num">' + esc(fmtDate(c.created_at)) + '</td><td style="white-space:nowrap"><button type="button" class="btn ghost small" data-a="editBuilder" data-v="' + esc(c.user_id) + '">Edit</button> ' + (open ? '<button type="button" class="btn blue small" data-a="actAs" data-v="' + esc(c.user_id) + '">Open</button> ' : '') + confirmBtn('c:' + c.user_id, 'delBuilder', c.user_id, 'Delete') + '</td></tr>';
        if (S.edit && S.edit.id === c.user_id) {
          const e = S.edit;
          row += '<tr><td colspan="8" style="background:var(--sunk)"><div class="stack" style="gap:10px"><div class="grid3">' +
            '<label class="f" for="eb-company">Company name<input id="eb-company" class="in sm" ' + P('edit.company', e.company) + '></label>' +
            '<label class="f" for="eb-phone">Mobile number<input id="eb-phone" class="in sm" type="tel" ' + P('edit.phone', e.phone) + '></label>' +
            '<label class="f" for="eb-gst">GST number<input id="eb-gst" class="in sm" ' + P('edit.gst', e.gst) + '></label></div>' +
            '<div class="row"><button type="button" class="btn blue small" data-a="saveEditBuilder">Save changes</button><button type="button" class="btn ghost small" data-a="cancelEdit">Cancel</button></div></div></td></tr>';
        }
        return row;
      }).join('') : '<tr><td colspan="8" class="muted">No builders found.</td></tr>') + '</tbody></table></div><span class="small muted">Deleting a builder cancels their open bookings. Refund any paid bookings from the Razorpay dashboard.</span></section>';
  }

  if (S.atab === 'bookings' && A.bookings) {
    const staff = A['staff-names'] || [];
    h += '<section class="card"><h2>Bookings</h2><span class="small muted">Assign a supervisor to a site. Every line of that order goes to the same supervisor.</span><div class="tablebox"><table><thead><tr><th>Builder</th><th>Work</th><th>Site</th><th>Start</th><th>Assigned</th><th>Payment</th><th>Amount</th><th>Status</th><th>Supervisor</th></tr></thead><tbody>' +
      (A.bookings.length ? A.bookings.map(b => '<tr><td>' + esc(b.company) + '</td><td>' + esc(b.count) + ' × ' + esc(b.skill_en) + '</td><td>' + esc(b.site) + (b.site_address ? '<div class="small muted">' + esc(b.site_address) + '</div>' : '') + '</td><td class="num">' + esc(fmtDate(b.start_date)) + '</td><td class="num">' + b.assigned + ' / ' + b.count + '</td><td>' + (b.pay_mode === 'lk' ? 'Via Labour Katta' : 'Direct') + ' · ' + esc(b.payment_status) + '</td><td class="num">' + money(b.amount_due) + (b.platform_fee ? '<div class="small muted">incl. ' + money(b.platform_fee) + ' platform fee</div>' : '') + '</td><td>' + statusPill(b) + '</td>' +
        '<td><select class="in sm" aria-label="Supervisor for ' + esc(b.site) + '" data-sup="' + esc(b.id) + '"><option value="">— None —</option>' + staff.map(x => '<option value="' + esc(x.id) + '"' + (b.supervisor_id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></td></tr>').join('') : '<tr><td colspan="9" class="muted">No bookings yet.</td></tr>') + '</tbody></table></div>' +
      (staff.length ? '' : '<span class="small muted">No supervisors yet. ' + (me.root ? 'Add them in the Supervisors tab.' : '') + '</span>') + '</section>';
  }

  if (S.atab === 'coupons' && A.coupons) {
    const cp = S.f.cp;
    h += '<section class="card"><h2>Create a coupon</h2><span class="small muted">Workers and builders enter the code when they sign up, or before paying. One coupon per account. You can also enter a code when adding someone from the Workers or Builders tab.</span><div class="grid3">' +
      '<label class="f" for="cp-new">Code<input id="cp-new" class="in" placeholder="e.g. DIWALI50" ' + P('f.cp.code', cp.code) + '></label>' +
      '<label class="f">For' + sel('f.cp.applies_to', cp.applies_to, [['both', 'Workers and builders'], ['builder', 'Builders only'], ['worker', 'Workers only']], 'For') + '</label>' +
      '<label class="f">Type' + sel('f.cp.kind', cp.kind, [['percent', '% off the monthly plan'], ['flat', '₹ off the monthly plan'], ['days', 'Free days']], 'Type') + '</label>' +
      '<label class="f" for="cp-val">' + (cp.kind === 'days' ? 'Free days' : cp.kind === 'flat' ? 'Amount off (₹)' : 'Percent off (1–99)') + '<input id="cp-val" class="in num" type="number" min="1" ' + P('f.cp.value', cp.value) + '></label>' +
      '<label class="f" for="cp-max">Maximum uses (empty = no limit)<input id="cp-max" class="in num" type="number" min="1" ' + P('f.cp.max_uses', cp.max_uses) + '></label>' +
      '<label class="f" for="cp-exp">Expires on (optional)<input id="cp-exp" class="in" type="date" ' + P('f.cp.expires', cp.expires) + '></label>' +
      '<label class="f" for="cp-note">Note (optional)<input id="cp-note" class="in" ' + P('f.cp.note', cp.note) + '></label></div>' +
      errBox() + '<button type="button" class="btn primary" style="align-self:flex-start" data-a="addCoupon">Create coupon</button></section>';
    h += '<section class="card"><h2>Coupons</h2><div class="tablebox"><table><thead><tr><th>Code</th><th>Gives</th><th>For</th><th>Used</th><th>Expires</th><th>Active</th><th></th></tr></thead><tbody>' +
      (A.coupons.length ? A.coupons.filter(c => !/-DEL-/.test(c.code)).map(c => '<tr><td><b class="num">' + esc(c.code) + '</b>' + (c.note ? '<div class="small muted">' + esc(c.note) + '</div>' : '') + '</td><td>' + esc(c.kind === 'days' ? c.value + ' days free' : c.kind === 'percent' ? c.value + '% off' : '₹' + c.value + ' off') + '</td><td>' + esc(c.applies_to === 'both' ? 'Everyone' : c.applies_to === 'builder' ? 'Builders' : 'Workers') + '</td>' +
        '<td class="num">' + c.uses + (c.max_uses ? ' / ' + c.max_uses : '') + '</td><td class="num">' + esc(c.expires ? fmtDate(c.expires) : '—') + '</td>' +
        '<td><input type="checkbox" style="width:22px;height:22px" aria-label="Active" data-cpa="' + esc(c.id) + '"' + (c.active ? ' checked' : '') + '></td><td>' + confirmBtn('cp:' + c.id, 'delCoupon', c.id, 'Delete') + '</td></tr>').join('') : '<tr><td colspan="7" class="muted">No coupons yet.</td></tr>') + '</tbody></table></div></section>';
  }

  if (S.atab === 'staff' && A.staff) {
    const st = A.staff, g = S.f.grp, nu = S.f.st;
    const permBoxes = (chosen, attr) => Object.keys(st.perms).map(p => '<label class="row small" style="gap:6px;align-items:center"><input type="checkbox" style="width:20px;height:20px" ' + attr(p) + (chosen.includes(p) ? ' checked' : '') + '> ' + esc(PERM_LABELS[p] || p) + '</label>').join('');
    h += '<section class="card"><h2>Groups and permissions</h2><span class="small muted">Each supervisor belongs to a group. Ticking a box gives everyone in that group that permission right away. Only you (the main admin) can manage supervisors.</span>' +
      (st.groups.length ? '<div class="list">' + st.groups.map(gr => '<div class="li" style="flex-wrap:wrap;align-items:flex-start"><div style="min-width:160px"><b>' + esc(gr.name) + '</b><div class="small muted">' + st.users.filter(u => u.group_id === gr.id).length + ' people</div></div>' +
        '<div class="row grow" style="gap:12px">' + permBoxes(gr.perms, p => 'data-gp="' + esc(gr.id) + '" data-perm="' + p + '"') + '</div>' + confirmBtn('g:' + gr.id, 'delGroup', gr.id, 'Delete') + '</div>').join('') + '</div>' : '') +
      '<h3>New group</h3><label class="f" for="grp-name">Group name<input id="grp-name" class="in" placeholder="e.g. Site supervisors" ' + P('f.grp.name', g.name) + '></label>' +
      '<div class="row" style="gap:12px">' + permBoxes(Object.keys(g.perms).filter(p => g.perms[p]), p => 'data-np="' + p + '"') + '</div>' +
      '<button type="button" class="btn primary" style="align-self:flex-start" data-a="addGroup">Create group</button></section>';
    h += '<section class="card"><h2>Supervisors</h2><span class="small muted">Supervisors sign in from "Admin / Supervisor login" with their own username and password. Workload = sites assigned to them in Bookings.</span>' +
      '<div class="tablebox"><table><thead><tr><th>Name</th><th>Username</th><th>Group</th><th>Workload</th><th>Active</th><th>New password</th><th></th></tr></thead><tbody>' +
      (st.users.length ? st.users.map(u => '<tr><td><b>' + esc(u.name) + '</b><div class="small muted num">' + esc(u.phone || '') + '</div></td><td class="num">' + esc(u.username) + '</td>' +
        '<td><select class="in sm" aria-label="Group for ' + esc(u.name) + '" data-sg="' + esc(u.id) + '"><option value="">— No group —</option>' + st.groups.map(gr => '<option value="' + esc(gr.id) + '"' + (u.group_id === gr.id ? ' selected' : '') + '>' + esc(gr.name) + '</option>').join('') + '</select></td>' +
        '<td class="num">' + u.workload + ' sites</td><td><input type="checkbox" style="width:22px;height:22px" aria-label="Active" data-sa="' + esc(u.id) + '"' + (u.active ? ' checked' : '') + '></td>' +
        '<td style="white-space:nowrap"><input id="pw-' + esc(u.id) + '" class="in sm" type="password" style="width:140px" placeholder="8+ characters" aria-label="New password for ' + esc(u.name) + '"> <button type="button" class="btn ghost small" data-a="resetPw" data-v="' + esc(u.id) + '">Set</button></td>' +
        '<td>' + confirmBtn('s:' + u.id, 'delStaff', u.id, 'Delete') + '</td></tr>').join('') : '<tr><td colspan="7" class="muted">No supervisors yet.</td></tr>') + '</tbody></table></div>' +
      '<h3>Add a supervisor</h3><div class="grid3">' +
      '<label class="f" for="st-name">Full name<input id="st-name" class="in" ' + P('f.st.name', nu.name) + '></label>' +
      '<label class="f" for="st-user">Username<input id="st-user" class="in" autocapitalize="off" ' + P('f.st.username', nu.username) + '></label>' +
      '<label class="f" for="st-pass">Password (8+ characters)<input id="st-pass" class="in" type="password" autocomplete="new-password" ' + P('f.st.password', nu.password) + '></label>' +
      '<label class="f" for="st-phone">Mobile (optional)<input id="st-phone" class="in" type="tel" ' + P('f.st.phone', nu.phone) + '></label>' +
      '<label class="f">Group' + sel('f.st.group_id', nu.group_id, [['', '— No group —']].concat(st.groups.map(gr => [gr.id, gr.name])), 'Group') + '</label></div>' +
      errBox() + '<button type="button" class="btn primary" style="align-self:flex-start" data-a="addStaff">Add supervisor</button></section>';
  }

  if (S.atab === 'reports' && A.reports) h += renderAdminReports();
  h += renderAdminMarket(A);
  if (S.atab === 'payments' && A.payments) {
    h += '<section class="card"><h2>Payments</h2><div class="tablebox"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Razorpay reference</th></tr></thead><tbody>' +
      (A.payments.length ? A.payments.map(p => '<tr><td class="num">' + esc(fmtTime(p.created_at)) + '</td><td>' + esc(p.kind.replace('_', ' ')) + (p.test ? ' <span class="pill p-amber">test</span>' : '') + '</td><td class="num">' + money(p.amount) + '</td><td><span class="pill ' + (p.status === 'paid' ? 'p-green' : 'p-grey') + '">' + esc(p.status) + '</span></td><td class="small num">' + esc(p.rzp_payment_id || p.rzp_order_id || p.rzp_subscription_id || '—') + '</td></tr>').join('') : '<tr><td colspan="5" class="muted">No payments yet.</td></tr>') + '</tbody></table></div></section>';
  }
  if (S.atab === 'outbox' && A.notifications) {
    h += '<section class="card"><h2>WhatsApp outbox</h2><span class="small muted">Every message the app sent or would send. "test" means no WhatsApp provider is connected yet.</span><div class="list">' +
      (A.notifications.length ? A.notifications.map(n => '<div class="li" style="align-items:flex-start"><span class="pill ' + (n.status === 'sent' ? 'p-green' : n.status === 'failed' ? 'p-red' : 'p-amber') + '">' + esc(n.status) + '</span><div class="grow"><b class="num">' + esc(n.phone) + '</b> · <span class="small muted">' + esc(n.template) + '</span><div class="small">' + esc(n.body) + '</div>' + (n.error ? '<div class="small" style="color:var(--red-ink)">' + esc(n.error) + '</div>' : '') + '</div><span class="small muted num">' + esc(fmtTime(n.created_at)) + '</span></div>').join('') : '<p class="muted" style="margin:0">No messages yet.</p>') + '</div></section>';
  }
  return h + '</div>';
}

function render() {
  renderTop();
  const app = document.getElementById('app');
  const ae = document.activeElement, focusId = ae && ae.id, ss = ae && ae.selectionStart, se = ae && ae.selectionEnd;
  document.documentElement.lang = S.lang;
  let html;
  const u = S.me && S.me.user;
  if (!S.me) html = '<p class="muted">' + esc(t('loading')) + '</p>';
  else if (!u && S.me.adminSession) html = renderAdmin();
  else if (!u) html = renderLogin();
  else if (S.view === 'admin' && isAdmin()) html = renderAdmin();
  else if (!u.role) html = renderRole();
  else if (u.role === 'contractor') html = S.me.contractor ? renderContractor() : renderContractorProfile();
  else if (u.role === 'partner') html = S.me.partner ? renderPartner() : (S.cats ? '<div class="login stack">' + renderPartnerProfile(false) + '</div>' : '<p class="muted">' + esc(t('loading')) + '</p>');
  else html = S.me.worker ? renderWorker() : '<div class="login stack">' + renderWorkerProfile(false) + '</div>';
  app.innerHTML = '<div style="padding-top:16px">' + html + '</div>';
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (ss != null && el.setSelectionRange) el.setSelectionRange(ss, se); } catch (e) { /* not a text field */ } } }
}

function fillWorkerForm() {
  const w = S.me && S.me.worker; if (!w) return;
  Object.assign(S.f, { wname: w.name, warea: w.area, wexp: w.experience || '1-3', wupi: w.upi_id });
  S.f.wskills = {}; w.skills.forEach(id => { S.f.wskills[id] = true; });
}

// ================= terms =================
function termsTick(key) {
  return '<div class="terms"><button type="button" class="tick" data-a="tickTerms" data-v="' + key + '" aria-pressed="' + !!S.f[key] + '"><span class="box" aria-hidden="true">' + (S.f[key] ? '✓' : '') + '</span><span>' + esc(t('termsTick')) + '</span></button>' +
    '<button type="button" class="linkbtn" data-a="showTerms">' + esc(t('termsRead')) + '</button></div>';
}
function showTerms() {
  showModal('<h2>' + esc(t('termsTitle')) + '</h2><div class="termsbody">' + t('termsText').split('\n').map(p => '<p>' + esc(p) + '</p>').join('') + '</div>' +
    '<button type="button" class="btn primary" data-a="closeTerms">' + esc(t('termsOk')) + '</button>');
  modalHandlers.closeTerms = () => closeModal();
}
// Builder: workers asking for more money on an open booking line.
function asksBlock(b) {
  if (!b.asks || !b.asks.length || b.status !== 'open') return '';
  return '<div class="panel"><b>' + esc(t('asksTitle', { n: b.asks.length })) + '</b>' + b.asks.map(w => workerMatchCard(Object.assign({}, w, { wage: null }),
    '') + '<div class="askbox"><div class="kv small"><span>' + esc(t('askStd', { w: money(w.stdWage), t: money(b.travel_per_day || 0) })) + '</span></div>' +
    '<div class="kv"><b>' + esc(t('askWants')) + '</b><b class="num">' + money(w.askWage) + esc(t('perDayShort')) + ' + ' + money(w.askTravel) + ' ' + esc(t('travelShort')) + '</b></div>' +
    (w.askNote ? '<div class="small">“' + esc(w.askNote) + '”</div>' : '') +
    '<div class="small muted">' + esc(t('askExtra', { a: money(((w.askWage - w.stdWage) + (w.askTravel - (b.travel_per_day || 0))) * b.days) })) + '</div>' +
    '<div class="row"><button type="button" class="btn blue small" data-a="askYes" data-v="' + esc(w.askId) + '">' + esc(t('askAccept')) + '</button><button type="button" class="btn ghost small" data-a="askNo" data-v="' + esc(w.askId) + '">' + esc(t('askDecline')) + '</button></div></div>').join('') + '</div>';
}

// ================= Phase 2 screens =================
const stars = (n) => n == null ? '' : '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
function relLine(rel, rt) {
  const parts = [];
  parts.push(rel && rel.score != null ? t('relScore', { s: rel.score }) : t('relNew'));
  if (rt && rt.count) parts.push('★ ' + rt.avg + ' (' + rt.count + ')');
  if (rel && rel.cancellations) parts.push(t('cancelsN', { n: rel.cancellations }));
  return parts.join(' · ');
}
function builderBadge(bf) {
  if (!bf) return '';
  return bf.verified ? '<span class="pill p-green">✓ ' + esc(t('builderVerified')) + '</span>' : '<span class="pill p-grey">' + esc(t('builderNotVerified')) + '</span>';
}
const favBtn = (wid, on) => '<button type="button" class="iconbtn' + (on ? ' on' : '') + '" data-a="fav" data-w="' + esc(wid) + '" data-v="' + (on ? 'off' : 'on') + '" aria-pressed="' + on + '" aria-label="' + esc(t(on ? 'favRemove' : 'favAdd')) + '" title="' + esc(t(on ? 'favRemove' : 'favAdd')) + '">' + (on ? '★' : '☆') + '</button>';
const blockBtn = (uid) => S.confirmBlock === uid
  ? '<button type="button" class="btn danger small" data-a="blockUser" data-v="' + esc(uid) + '">' + esc(t('blockConfirm')) + '</button> <button type="button" class="btn ghost small" data-a="noBlock">' + esc(t('keep')) + '</button>'
  : '<button type="button" class="btn ghost small" data-a="askBlock" data-v="' + esc(uid) + '">' + esc(t('block')) + '</button>';

// Worker card used in the picker and in Find workers (no phone number).
function workerMatchCard(w, extra) {
  const why = [w.distanceKm != null ? t('kmAway', { d: w.distanceKm }) : '', w.area, w.experience ? t('expYears', { y: w.experience }) : '', relLine(w.reliability, w.rating)].filter(Boolean).join(' · ');
  return '<div class="li wcard"><div class="av" aria-hidden="true">' + esc(initials(w.name)) + '</div><div class="grow"><div class="row" style="gap:6px"><b>' + esc(w.name) + '</b>' +
    '<span class="pill ' + (w.tier === 'gold' ? 'p-amber' : w.tier === 'silver' ? 'p-blue' : 'p-grey') + '">' + esc(t(w.tier)) + '</span>' +
    (w.score != null ? '<span class="pill p-green num" title="' + esc(t('matchHelp')) + '">' + esc(t('matchPct', { s: w.score })) + '</span>' : '') + '</div>' +
    '<div class="small muted">' + esc(why) + '</div>' + vBadges(w.v) +
    (w.wage != null ? '<div class="small num">' + money(w.wage) + esc(t('perDayShort')) + '</div>' : '') + '</div>' +
    '<div class="row" style="gap:6px;justify-content:flex-end">' + favBtn(w.worker_id, w.favourite) + (extra || '') + '</div></div>';
}
function pickFilter(list) {
  const f = S.pf;
  const q = (f.area || '').trim().toLowerCase();
  return list.filter(w => (!q || String(w.area || '').toLowerCase().includes(q)) && (!f.verified || (w.v && w.v.id)) && (!f.fav || w.favourite)
    && (!f.minRating || (w.rating && w.rating.avg >= Number(f.minRating))) && (!f.maxWage || w.wage <= Number(f.maxWage))
    && (!f.exp || ['0-1', '1-3', '3-5', '5+'].indexOf(w.experience) >= ['0-1', '1-3', '3-5', '5+'].indexOf(f.exp)));
}
function pickFilterBar() {
  const f = S.pf;
  return '<div class="filters"><input id="pf-area" class="in sm" placeholder="' + esc(t('fArea')) + '" aria-label="' + esc(t('fArea')) + '" ' + P('pf.area', f.area) + '>' +
    sel('pf.exp', f.exp, [['', t('fExpAny')], ['1-3', t('expMin', { y: '1' })], ['3-5', t('expMin', { y: '3' })], ['5+', t('expMin', { y: '5' })]], t('experience')) +
    sel('pf.minRating', f.minRating, [['', t('fRatingAny')], ['3', '3★+'], ['4', '4★+'], ['4.5', '4.5★+']], t('fRating')) +
    '<input id="pf-wage" class="in sm num" type="number" min="0" placeholder="' + esc(t('fMaxWage')) + '" aria-label="' + esc(t('fMaxWage')) + '" ' + P('pf.maxWage', f.maxWage) + '>' +
    '<button type="button" class="chip" style="min-height:40px" data-a="pfToggle" data-v="verified" aria-pressed="' + !!f.verified + '">' + esc(t('fVerified')) + '</button>' +
    '<button type="button" class="chip" style="min-height:40px" data-a="pfToggle" data-v="fav" aria-pressed="' + !!f.fav + '">★ ' + esc(t('fFav')) + '</button></div>';
}

// ----- builder: dashboard -----
function renderDash() {
  const d = S.data.dash; if (!d) return '';
  const a = d.attendance;
  const tile = (lbl, val, cls, sub) => '<section class="card kpi ' + (cls || '') + '"><span class="lbl">' + esc(lbl) + '</span><span class="big num">' + esc(val) + '</span>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</section>';
  let h = '<div class="kpis">' +
    tile(t('dActive'), d.activeOrders, 'hero', t('dActiveSub', { n: d.activeLines })) +
    tile(t('dConfirmed'), d.confirmed) +
    tile(t('dRequired'), d.required, d.required ? 'warn' : '') +
    tile(t('dToday'), (a.present + a.late) + ' / ' + a.expected, '', t('dTodaySub', { a: a.absent, n: a.notCheckedIn })) +
    tile(t('dPending'), money(d.wagesOutstanding + d.unpaidBookings), d.wagesOutstanding + d.unpaidBookings ? 'warn' : '', t('dPendingSub')) +
    tile(t('dUpcoming'), d.upcoming.length, '', t('dUpcomingSub')) + '</div>';
  if (d.unconfirmed) h += '<div class="status s-warn">' + esc(t('dUnconfirmed', { n: d.unconfirmed })) + '</div>';
  if (d.wagesToFinalise) h += '<div class="status s-warn">' + esc(t('dToFinalise', { n: d.wagesToFinalise })) + '</div>';
  h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>' + esc(t('siteSummary')) + '</h2><span class="small muted">' + esc(fmtDate(d.today)) + '</span></div>';
  if (!d.sites.length) h += '<p class="muted" style="margin:0">' + esc(t('noSitesToday')) + '</p>';
  else {
    const stat = (k, v, cls) => '<div class="stat ' + (cls || '') + '"><b class="num">' + v + '</b><span>' + esc(t(k)) + '</span></div>';
    const block = (s, title) => '<div class="sitebox"><div class="row" style="justify-content:space-between"><b>' + esc(title) + '</b>' + (s.vacancies ? '<span class="pill p-red">' + esc(t('vacanciesN', { n: s.vacancies })) + '</span>' : '') + '</div><div class="stats">' +
      stat('sExpected', s.expected) + stat('present', s.present, 'ok') + stat('late', s.late) + stat('absent', s.absent, s.absent ? 'bad' : '') + stat('sCheckedIn', s.checkedIn) + stat('sNotIn', s.notCheckedIn, s.notCheckedIn ? 'warn' : '') + '</div></div>';
    h += d.sites.map(s => block(s, s.site)).join('');
    if (d.sites.length > 1) h += block(Object.assign({ vacancies: d.sites.reduce((x, s) => x + s.vacancies, 0) }, a), t('allSites'));
  }
  h += '</section>';
  if (d.upcoming.length) h += '<section class="card"><h2>' + esc(t('dUpcoming')) + '</h2><div class="list">' + d.upcoming.map(u => '<div class="li"><div class="grow"><b>' + esc(u.count) + ' × ' + esc(bSkill(u)) + '</b><div class="small muted">' + esc(u.site) + ' · ' + esc(fmtDate(u.start_date)) + '</div></div><span class="pill ' + (u.assigned >= u.count ? 'p-green' : 'p-amber') + ' num">' + u.assigned + ' / ' + u.count + '</span></div>').join('') + '</div></section>';
  return h;
}

// ----- builder: booking card extras -----
function teamExtras(b, w) {
  let h = '';
  const pills = [];
  if (!b.started && b.status !== 'cancelled') pills.push(w.confirmed_at ? '<span class="pill p-green">' + esc(t('confirmedComing')) + '</span>' : '<span class="pill p-amber">' + esc(t('notConfirmedYet')) + '</span>');
  h += (pills.length ? '<div class="row" style="gap:6px">' + pills.join('') + '</div>' : '') + '<div class="small muted">' + esc(relLine(w.reliability, w.rating)) + '</div>';
  if (b.ended) {
    const my = w.myRating;
    h += '<div class="row" style="gap:4px;align-items:center"><span class="small">' + esc(t('rateWorker')) + '</span>' +
      (my && my.dispute_status === 'open' ? '<span class="pill p-amber">' + esc(t('ratingUnderReview')) + '</span>' :
        [1, 2, 3, 4, 5].map(n => '<button type="button" class="star' + (my && my.stars >= n ? ' on' : '') + '" data-a="rate" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '" data-v="' + n + '" aria-label="' + n + ' ★">★</button>').join('')) + '</div>';
  }
  return h;
}
function bookingPanels(b) {
  if (b.status === 'cancelled' || b.status === 'pending_payment') return '';
  const p = S.panel[b.id] || '';
  const btn = (k, label) => '<button type="button" class="btn ghost small" data-a="panel" data-b="' + esc(b.id) + '" data-v="' + k + '" aria-pressed="' + (p === k) + '">' + esc(label) + '</button>';
  let h = '<div class="row" style="gap:8px">' + (b.team.length && b.started ? btn('reg', t('pRegister')) : '') + (b.team.length ? btn('notice', t('pNotice')) : '') +
    '<button type="button" class="btn ghost small" data-a="bookAgain" data-b="' + esc(b.id) + '">' + esc(t('pAgain')) + '</button>' +
    (b.team.length ? btn('team', t('pTeam')) : '') +
    '<button type="button" class="btn ghost small" data-a="reportFor" data-b="' + esc(b.id) + '">' + esc(t('pReport')) + '</button></div>';
  if (p === 'notice') h += '<div class="panel"><label class="f" for="nt-' + esc(b.id) + '">' + esc(t('noticeLabel')) + '<textarea id="nt-' + esc(b.id) + '" class="in ta" maxlength="300" placeholder="' + esc(t('noticePh')) + '" data-p="f.noticeText">' + esc(S.f.noticeText || '') + '</textarea></label>' +
    '<span class="small muted">' + esc(t('noticeNote')) + '</span><button type="button" class="btn danger" data-a="sendNotice" data-b="' + esc(b.id) + '">' + esc(t('noticeSend')) + '</button></div>';
  if (p === 'team') h += '<div class="panel"><label class="f" for="tn-' + esc(b.id) + '">' + esc(t('teamName')) + '<input id="tn-' + esc(b.id) + '" class="in" maxlength="60" placeholder="' + esc(t('teamNamePh')) + '" ' + P('f.teamName', S.f.teamName) + '></label>' +
    '<button type="button" class="btn blue" data-a="saveTeam" data-b="' + esc(b.id) + '">' + esc(t('teamSave')) + '</button></div>';
  if (p === 'reg') h += renderRegister(b);
  return h;
}
function renderRegister(b) {
  const R = S.reg && S.reg.id === b.id ? S.reg.data : null;
  if (!R) return '<div class="panel"><span class="muted">' + esc(t('loading')) + '</span></div>';
  const bk = R.booking;
  let h = '<div class="panel"><div class="grid2"><label class="f">' + esc(t('reportTime')) + '<input class="in sm" type="time" value="' + esc(b.report_time || '09:00') + '" data-terms="reportTime" data-b="' + esc(b.id) + '"></label>' +
    '<label class="f">' + esc(t('otRateLbl')) + '<input class="in sm num" type="number" min="0" placeholder="' + esc(money(bk.otRateEff)) + '" value="' + esc(bk.ot_rate == null ? '' : bk.ot_rate) + '" data-terms="otRate" data-b="' + esc(b.id) + '"></label></div>' +
    '<span class="small muted">' + esc(t('otNote', { r: money(bk.otRateEff), m: settings().ot_multiplier || 2 })) + '</span>';
  for (const m of R.team) {
    const locked = !!m.pay.finalAt;
    h += '<div class="regw"><div class="row" style="justify-content:space-between"><b>' + esc(m.name) + '</b>' +
      (locked ? '<span class="pill p-green">' + esc(t('finalised', { a: money(m.pay.finalAmount) })) + '</span>' : '') + '</div><div class="reggrid">' +
      R.dates.map(d => {
        const x = m.days[d] || {};
        return '<div class="regday"><span class="small num">' + esc(fmtDate(d).replace(/ \d{4}$/, '')) + '</span>' +
          '<select class="in sm" aria-label="' + esc(m.name + ' ' + d) + '" data-reg="' + esc(b.id) + '" data-w="' + esc(m.worker_id) + '" data-d="' + d + '"' + (locked ? ' disabled' : '') + '>' +
          '<option value="">—</option>' + ['present', 'late', 'absent'].map(s => '<option value="' + s + '"' + (x.status === s ? ' selected' : '') + '>' + esc(t(s)) + '</option>').join('') + '</select>' +
          '<input class="in sm num" type="number" min="0" max="12" step="0.5" placeholder="' + esc(t('otH')) + '" aria-label="' + esc(t('otH') + ' ' + d) + '" value="' + esc(x.ot_hours ? x.ot_hours : '') + '" data-ot="' + esc(b.id) + '" data-w="' + esc(m.worker_id) + '" data-d="' + d + '"' + (locked || !x.status || x.status === 'absent' ? ' disabled' : '') + '></div>';
      }).join('') + '</div>' +
      '<div class="kv small"><span>' + esc(t('regSum', { d: m.pay.payDays, w: money(m.pay.wage), h: m.pay.otHours, r: money(m.pay.otRate) })) + (m.pay.travel ? ' + ' + esc(t('regTravel', { d: m.pay.payDays, t: money(m.pay.travel) })) : '') + '</span><b class="num">' + money(m.pay.earned) + '</b></div>' +
      (locked ? '' : '<button type="button" class="btn blue small" style="align-self:flex-start" data-a="finalise" data-b="' + esc(b.id) + '" data-w="' + esc(m.worker_id) + '">' + esc(t('finaliseBtn', { a: money(m.pay.earned) })) + '</button>') + '</div>';
  }
  return h + '<span class="small muted">' + esc(t('finaliseNote')) + '</span></div>';
}

// ----- builder: Find workers + saved teams -----
function renderFind() {
  const f = S.ws, skills = S.me.skills;
  let h = '<section class="card"><h2>' + esc(t('findTitle')) + '</h2><div class="grid3">' +
    '<label class="f">' + esc(t('fSkill')) + sel('ws.skill', f.skill, [['', t('fSkillAny')]].concat(skills.map(s => [s.id, skillName(s)])), t('fSkill')) + '</label>' +
    '<label class="f">' + esc(t('fArea')) + '<input class="in sm" ' + P('ws.area', f.area) + '></label>' +
    '<label class="f">' + esc(t('experience')) + sel('ws.exp', f.exp, [['', t('fExpAny')], ['1-3', t('expMin', { y: '1' })], ['3-5', t('expMin', { y: '3' })], ['5+', t('expMin', { y: '5' })]], t('experience')) + '</label>' +
    '<label class="f">' + esc(t('fRating')) + sel('ws.minRating', f.minRating, [['', t('fRatingAny')], ['3', '3★+'], ['4', '4★+'], ['4.5', '4.5★+']], t('fRating')) + '</label>' +
    '<label class="f">' + esc(t('fMaxWage')) + '<input class="in sm num" type="number" min="0" ' + P('ws.maxWage', f.maxWage) + '></label>' +
    '<label class="f">' + esc(t('level')) + sel('ws.level', f.level, [['any', t('lvAny')], ['silver', t('lvSilver')], ['gold', t('lvGold')]], t('level')) + '</label>' +
    '<label class="f">' + esc(t('fFreeFrom')) + '<input class="in sm" type="date" min="' + istDate(0) + '" ' + P('ws.start', f.start) + '></label>' +
    '<label class="f">' + esc(t('days')) + sel('ws.days', f.days, [['1', '1'], ['3', '3'], ['5', '5'], ['7', '7'], ['15', '15'], ['30', '30']], t('days')) + '</label></div>' +
    '<div class="chips"><button type="button" class="chip" data-a="wsToggle" data-v="verified" aria-pressed="' + !!f.verified + '">' + esc(t('fVerified')) + '</button><button type="button" class="chip" data-a="wsToggle" data-v="fav" aria-pressed="' + !!f.fav + '">★ ' + esc(t('fFav')) + '</button></div>' +
    '<button type="button" class="btn primary" data-a="searchWorkers">' + esc(t('fSearch')) + '</button></section>';
  if (f.results) {
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>' + esc(t('fResults', { n: f.total })) + '</h2><span class="small muted">' + esc(t('matchHelp')) + '</span></div>' +
      (f.results.length ? '<div class="list">' + f.results.map(w => workerMatchCard(w, blockBtn(w.worker_id))).join('') + '</div>' : '<p class="muted" style="margin:0">' + esc(t('fNone')) + '</p>') +
      '<span class="small muted">' + esc(t('phoneHidden')) + '</span></section>';
  }
  h += '<section class="card"><h2>' + esc(t('teamsTitle')) + '</h2>' + (S.data.teams.length ? '<div class="list">' + S.data.teams.map(tm => '<div class="li" style="flex-wrap:wrap"><div class="grow"><b>' + esc(tm.name) + '</b><div class="small muted">' +
    esc(tm.members.map(m => m.name + ' (' + bSkill(m) + ')').join(', ')) + '</div></div><button type="button" class="btn blue small" data-a="bookTeam" data-v="' + esc(tm.id) + '">' + esc(t('teamBook')) + '</button>' + confirmBtn('tm:' + tm.id, 'delTeam', tm.id, t('delete')) + '</div>').join('') + '</div>'
    : '<p class="muted small" style="margin:0">' + esc(t('teamsNone')) + '</p>') + '</section>';
  return h;
}

// ----- both: help, reports and blocks -----
const CATS = ['payment', 'misconduct', 'unsafe', 'fraud', 'accident', 'other'];
function renderSupport(jobs) {
  const r = S.rep;
  let h = '<div class="status s-err">' + esc(t('emergencyNote')) + '</div>' +
    '<section class="card"><h2>' + esc(t('reportTitle')) + '</h2>' +
    '<label class="f">' + esc(t('reportCat')) + sel('rep.category', r.category, CATS.map(c => [c, t('cat_' + c)]), t('reportCat')) + '</label>' +
    '<label class="f">' + esc(t('reportJob')) + sel('rep.bookingId', r.bookingId, [['', t('reportNoJob')]].concat(jobs.map(b => [b.id, b.site + ' · ' + bSkill(b) + ' · ' + fmtDate(b.start_date)])), t('reportJob')) + '</label>' +
    '<label class="f" for="rp-text">' + esc(t('reportText')) + '<textarea id="rp-text" class="in ta" maxlength="1000" data-p="rep.text">' + esc(r.text) + '</textarea></label>' +
    '<button type="button" class="opt" data-a="repUrgent" aria-pressed="' + !!r.urgent + '"><span class="dot"></span><span><b>' + esc(t('reportUrgent')) + '</b><br><span class="small">' + esc(t('reportUrgentSub')) + '</span></span></button>' +
    errBox() + '<button type="button" class="btn primary" data-a="sendReport">' + esc(t('reportSend')) + '</button></section>';
  const mine = S.data.reports || [];
  h += '<section class="card"><h2>' + esc(t('myReports')) + '</h2>' + (mine.length ? '<div class="list">' + mine.map(x => '<div class="li" style="align-items:flex-start"><span class="pill ' + (x.status === 'open' ? 'p-amber' : 'p-green') + '">' + esc(t(x.status === 'open' ? 'repOpen' : 'repResolved')) + '</span><div class="grow"><b>' + esc(t('cat_' + x.category)) + '</b>' + (x.site ? ' · ' + esc(x.site) : '') +
    '<div class="small">' + esc(x.text) + '</div>' + (x.resolution ? '<div class="small" style="color:var(--green-ink)">' + esc(t('repDecision')) + ': ' + esc(x.resolution) + '</div>' : '') + '</div><span class="small muted num">' + esc(fmtTime(x.created_at)) + '</span></div>').join('') + '</div>' : '<p class="muted small" style="margin:0">' + esc(t('noReports')) + '</p>') + '</section>';
  const bl = S.data.blocks || [];
  h += '<section class="card"><h2>' + esc(t('blockedTitle')) + '</h2><span class="small muted">' + esc(t('blockedSub')) + '</span>' + (bl.length ? '<div class="list">' + bl.map(x => '<div class="li"><div class="grow"><b>' + esc(x.name) + '</b></div><button type="button" class="btn ghost small" data-a="unblock" data-v="' + esc(x.blocked_id) + '">' + esc(t('unblock')) + '</button></div>').join('') + '</div>' : '<p class="muted small" style="margin:0">' + esc(t('noBlocked')) + '</p>') + '</section>';
  return h;
}

// ----- worker: availability, calendar, travel -----
function availControl(w) {
  const st = w.avail_status || 'available';
  let h = '<section class="card"><h2>' + esc(t('availTitle')) + '</h2>' +
    opt('availSet', 'st', 'available', st === 'available', t('stAvailable'), t('stAvailableSub')) +
    opt('availSet', 'st', 'busy', st === 'busy', t('stBusy'), st === 'busy' && w.busy_until ? t('busyUntilD', { d: fmtDate(w.busy_until) }) : t('stBusySub')) +
    opt('availSet', 'st', 'unavailable', st === 'unavailable', t('stUnavailable'), t('stUnavailableSub'));
  if (S.f.availPick === 'busy') h += '<div class="row" style="align-items:flex-end"><label class="f grow" for="busy-until">' + esc(t('busyUntil')) + '<input id="busy-until" class="in" type="date" min="' + istDate(0) + '" data-f="busyUntil" value="' + esc(S.f.busyUntil || '') + '"></label><button type="button" class="btn blue" data-a="saveBusy">' + esc(t('save')) + '</button></div>';
  return h + '</section>';
}
function renderCalendar() {
  const C = S.data.calendar; if (!C) return '';
  const off = new Set(C.off);
  const job = (d) => C.jobs.find(j => j.start <= d && j.end >= d);
  const days = []; for (let i = 0; i < 56; i++) days.push(istDate(i));
  const first = new Date(days[0] + 'T00:00:00+05:30').getDay(); // 0 = Sunday
  const wk = S.lang === 'hi' ? ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'] : S.lang === 'mr' ? ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let h = '<section class="card"><h2>' + esc(t('calTitle')) + '</h2><span class="small muted">' + esc(t('calSub')) + '</span>' +
    '<div class="cal">' + wk.map(x => '<span class="calh">' + x + '</span>').join('') + '<span class="calpad" style="grid-column:span ' + first + '"></span>'.repeat(first ? 1 : 0) +
    days.map(d => {
      const j = job(d), isOff = off.has(d), dd = Number(d.slice(8));
      return '<button type="button" class="calday' + (j ? ' job' : isOff ? ' off' : '') + '" data-a="dayOff" data-v="' + d + '"' + (j ? ' disabled title="' + esc(j.site) + '"' : '') + ' aria-pressed="' + isOff + '" aria-label="' + esc(fmtDate(d)) + '">' + dd + (dd === 1 || d === days[0] ? '<small>' + esc(new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { month: 'short' })) + '</small>' : '') + '</button>';
    }).join('') + '</div>' +
    '<div class="row small" style="gap:14px"><span><i class="lg free"></i>' + esc(t('calFree')) + '</span><span><i class="lg off"></i>' + esc(t('calOff')) + '</span><span><i class="lg job"></i>' + esc(t('calJob')) + '</span></div></section>';
  return h;
}
function travelControl(w) {
  const r = w.radius_km || 0;
  return '<section class="card"><h2>' + esc(t('travelTitle')) + '</h2><span class="small muted">' + esc(t('travelSub')) + '</span>' +
    '<div class="row"><button type="button" class="btn ghost small" data-a="setHome">📍 ' + esc(w.home_lat != null ? t('homeUpdate') : t('homeSet')) + '</button>' + (w.home_lat != null ? '<span class="pill p-green">' + esc(t('homeIsSet')) + '</span>' : '<span class="pill p-grey">' + esc(t('homeNotSet')) + '</span>') + '</div>' +
    '<div class="chips">' + [[0, t('radiusAny')], [5, '5 km'], [10, '10 km'], [15, '15 km'], [25, '25 km'], [50, '50 km']].map(o => '<button type="button" class="chip" data-a="setRadius" data-v="' + o[0] + '" aria-pressed="' + (r === o[0]) + '">' + esc(o[1]) + '</button>').join('') + '</div>' +
    (r && w.home_lat == null ? '<div class="status s-warn">' + esc(t('radiusNeedsHome')) + '</div>' : '') + '</section>';
}

// ----- worker: level, reliability, ratings -----
function renderLevel(w) {
  const R = S.data.ratings;
  const lv = [['bronze', 'levelBronze'], ['silver', 'levelSilver'], ['gold', 'levelGold']];
  let h = '<section class="card hero"><span class="small muted">' + esc(t('yourLevel')) + '</span><span class="big">' + esc(t(w.tier)) + '</span><span class="small">' + esc(relLine(w.reliability, w.rating)) + '</span></section>' +
    '<section class="card"><h2>' + esc(t('levelsTitle')) + '</h2><div class="list">' + lv.map(x => '<div class="li" style="align-items:flex-start"><span class="pill ' + (x[0] === 'gold' ? 'p-amber' : x[0] === 'silver' ? 'p-blue' : 'p-grey') + '">' + esc(t(x[0])) + '</span><div class="grow small">' + esc(t(x[1])) + '</div>' + (w.tier === x[0] ? '<b class="small" style="color:var(--green-ink)">' + esc(t('youAreHere')) + '</b>' : '') + '</div>').join('') + '</div>' +
    '<span class="small muted">' + esc(t('levelNote')) + '</span>';
  if (w.nextLevel && w.nextLevel.length && w.tier !== 'gold') h += '<b>' + esc(t('nextSteps')) + '</b><ul class="small" style="margin:0;padding-left:20px">' + w.nextLevel.map(k => '<li>' + esc(t('next_' + k)) + '</li>').join('') + '</ul>';
  h += '</section>';
  const rel = w.reliability || {};
  h += '<section class="card"><h2>' + esc(t('relTitle')) + '</h2><div class="stats">' +
    [['present', rel.present], ['late', rel.late], ['absent', rel.absent], ['cancelsLbl', rel.cancellations], ['jobsDoneLbl', rel.jobsDone]].map(x => '<div class="stat"><b class="num">' + (x[1] || 0) + '</b><span>' + esc(t(x[0])) + '</span></div>').join('') + '</div>' +
    '<span class="small muted">' + esc(t('relHelp')) + '</span></section>';
  h += '<section class="card"><h2>' + esc(t('ratingsTitle')) + '</h2>';
  if (!R) h += '<span class="muted">' + esc(t('loading')) + '</span>';
  else if (!R.ratings.length) h += '<p class="muted small" style="margin:0">' + esc(t('noRatings')) + '</p>';
  else h += '<div class="list">' + R.ratings.map(x => '<div class="li" style="flex-wrap:wrap;align-items:flex-start"><div class="grow"><b class="stars">' + stars(x.stars) + '</b> · ' + esc(x.company) + '<div class="small muted">' + esc(x.site) + ' · ' + esc(fmtDate(x.created_at)) + '</div>' + (x.comment ? '<div class="small">“' + esc(x.comment) + '”</div>' : '') +
    (x.dispute_status === 'open' ? '<span class="pill p-amber">' + esc(t('disputeOpen')) + '</span>' : x.dispute_status === 'removed' ? '<span class="pill p-green">' + esc(t('disputeRemoved')) + '</span>' : x.dispute_status === 'kept' ? '<span class="pill p-grey">' + esc(t('disputeKept')) + '</span>' : '') + '</div>' +
    (x.dispute_status === 'none' ? (S.disputeFor === x.booking_id ? '<div class="stack" style="gap:8px;flex-basis:100%"><textarea class="in ta" maxlength="500" placeholder="' + esc(t('disputePh')) + '" data-p="f.disputeText">' + esc(S.f.disputeText || '') + '</textarea><div class="row"><button type="button" class="btn blue small" data-a="sendDispute" data-v="' + esc(x.booking_id) + '">' + esc(t('disputeSend')) + '</button><button type="button" class="btn ghost small" data-a="noDispute">' + esc(t('cancel')) + '</button></div></div>'
      : '<button type="button" class="btn ghost small" data-a="askDispute" data-v="' + esc(x.booking_id) + '">' + esc(t('disputeBtn')) + '</button>') : '') + '</div>').join('') + '</div>';
  return h + '<span class="small muted">' + esc(t('ratingsNote')) + '</span></section>';
}
// Worker: ask the builder for more money on a job offer.
function askStatus(b) {
  const a = b.myAsk; if (!a) return '';
  const what = money(a.wage) + t('perDayShort') + ' + ' + money(a.travel) + ' ' + t('travelShort');
  if (a.status === 'pending') return '<div class="status s-warn">' + esc(t('askPending', { a: what })) + '</div>';
  if (a.status === 'declined') return '<div class="status s-err">' + esc(t('askWasDeclined', { w: money(b.wage) })) + '</div>';
  return '';
}
function askForm(b) {
  const a = b.myAsk;
  if (a && (a.status === 'pending' || a.status === 'declined')) return '';
  if (S.askFor !== b.id) return '<button type="button" class="btn ghost wide" data-a="askOpen" data-b="' + esc(b.id) + '">💬 ' + esc(t('askMore')) + '</button>';
  const f = S.f.ask;
  return '<div class="panel"><b>' + esc(t('askMore')) + '</b><span class="small muted">' + esc(t('askHelp', { w: money(b.wage) })) + '</span><div class="grid2">' +
    '<label class="f" for="ask-w">' + esc(t('askWage')) + '<input id="ask-w" class="in num" type="number" min="' + b.wage + '" ' + P('f.ask.wage', f.wage) + '></label>' +
    '<label class="f" for="ask-t">' + esc(t('askTravel')) + '<input id="ask-t" class="in num" type="number" min="0" ' + P('f.ask.travel', f.travel) + '></label></div>' +
    '<label class="f" for="ask-n">' + esc(t('askNote')) + '<input id="ask-n" class="in" maxlength="200" placeholder="' + esc(t('askNotePh')) + '" ' + P('f.ask.note', f.note) + '></label>' +
    '<div class="row"><button type="button" class="btn primary" data-a="sendAsk" data-b="' + esc(b.id) + '"' + (S.f.wterms ? '' : ' disabled') + '>' + esc(t('askSend')) + '</button><button type="button" class="btn ghost" data-a="askClose">' + esc(t('cancel')) + '</button></div></div>';
}
// Worker: extras on a job in My work
function workExtras(b) {
  let h = builderBadge(b.builder);
  h += '<div class="kv small"><span>' + esc(t(b.agreed ? 'agreedPay' : 'yourPay')) + '</span><b class="num">' + money(b.wage) + esc(t('perDayShort')) + (b.travel ? ' + ' + money(b.travel) + ' ' + esc(t('travelShort')) : '') + '</b></div>';
  if (b.agreed && b.pay_mode === 'lk') h += '<span class="small muted">' + esc(t('agreedExtraNote')) + '</span>';
  if (b.auto_assigned && !b.confirmed_at) h += '<div class="status s-warn">' + esc(t('autoAssignedNote')) + '</div>';
  const soon = b.start_date >= istDate(0) && b.start_date <= istDate(2);
  if (b.confirmed_at) h += ' <span class="pill p-green">' + esc(t('youConfirmed')) + '</span>';
  else if ((soon || !b.terms_ok) && b.end_date >= istDate(0)) h += (b.terms_ok ? '' : termsTick('wterms')) + '<button type="button" class="btn primary wide" data-a="confirmJob" data-b="' + esc(b.id) + '"' + (b.terms_ok || S.f.wterms ? '' : ' disabled') + '>✓ ' + esc(t('iWillCome', { t: b.report_time || '09:00' })) + '</button>';
  if (b.report_time) h += '<span class="small">' + esc(t('reportBy', { t: b.report_time })) + '</span>';
  if (b.register && b.register.length) h += '<details class="small"><summary>' + esc(t('myRegister', { n: b.register.length })) + '</summary><div class="list">' + b.register.map(x => '<div class="li" style="padding:6px 0"><span class="grow num">' + esc(fmtDate(x.date)) + '</span><span>' + esc(t(x.status)) + (x.ot_hours ? ' + ' + x.ot_hours + 'h OT' : '') + '</span></div>').join('') + '</div></details>';
  if (b.pay && b.pay.finalAt) h += '<div class="status s-ok">' + esc(t('wagesFinalW', { a: money(b.pay.finalAmount) })) + '</div>';
  h += '<div class="row" style="gap:8px"><button type="button" class="btn ghost small" data-a="reportFor" data-b="' + esc(b.id) + '" data-v="payment">' + esc(t('payProblem')) + '</button><button type="button" class="btn ghost small" data-a="reportFor" data-b="' + esc(b.id) + '">' + esc(t('pReport')) + '</button></div>';
  return h;
}

// ----- admin: reports & disputes -----
function renderAdminReports() {
  const list = (S.admin.reports || []).filter(x => S.f.rf === 'all' || x.status === S.f.rf);
  let h = '<section class="card"><div class="row" style="justify-content:space-between"><h2>Reports & disputes</h2>' + seg('rf', [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']], S.f.rf) + '</div>' +
    '<span class="small muted">Urgent reports and accidents are also sent to the admin phones on WhatsApp. Decide each one and write what was decided — the person who reported it sees your decision.</span></section>';
  if (!list.length) return h + empty('Nothing here.');
  return h + list.map(x => '<section class="card"><div class="row" style="justify-content:space-between"><div class="row" style="gap:6px">' + (x.urgent ? '<span class="pill p-red">URGENT</span>' : '') +
    '<span class="pill p-blue">' + esc(x.kind) + '</span><b>' + esc(x.category) + '</b></div><span class="small muted num">' + esc(fmtTime(x.created_at)) + '</span></div>' +
    '<div class="small">From <b>' + esc(x.from_name) + '</b>' + (x.against_name ? ' about <b>' + esc(x.against_name) + '</b>' : '') + (x.site ? ' · ' + esc(x.site) : '') + '</div>' +
    '<p style="margin:0">' + esc(x.text) + '</p>' +
    (x.rating ? '<div class="small">Rating: <b class="stars">' + stars(x.rating.stars) + '</b>' + (x.rating.comment ? ' “' + esc(x.rating.comment) + '”' : '') + '</div>' : '') +
    (x.status === 'open' ? '<label class="f" for="res-' + esc(x.id) + '">What was decided<input id="res-' + esc(x.id) + '" class="in sm" maxlength="500" placeholder="e.g. Called both, builder paid ₹600 on 12 Oct"></label><div class="row">' +
      (x.kind === 'rating' ? '<button type="button" class="btn danger small" data-a="resolveRep" data-v="' + esc(x.id) + '" data-k="remove">Remove rating</button><button type="button" class="btn ghost small" data-a="resolveRep" data-v="' + esc(x.id) + '" data-k="keep">Keep rating</button>'
        : '<button type="button" class="btn blue small" data-a="resolveRep" data-v="' + esc(x.id) + '">Mark resolved</button>') + '</div>'
      : '<div class="status s-ok">Resolved: ' + esc(x.resolution) + '</div>') + '</section>').join('');
}

// ================= Projects marketplace =================
const catName = (c) => !c ? '' : (S.lang === 'hi' && c.hi) || (S.lang === 'mr' && c.mr) || c.en;
const grpName = (g) => !g ? '' : (S.lang === 'hi' && g.hi) || (S.lang === 'mr' && g.mr) || g.en;
const allCats = () => (S.cats || []).reduce((a, g) => a.concat(g.categories.map(c => Object.assign({ g }, c))), []);
const findCat = (id) => allCats().find(c => c.id === id);
async function loadCats() { if (!S.cats) S.cats = (await api('GET', '/api/categories')).groups; }
function catSelect(path, value, placeholder, label) {
  return '<select class="in" aria-label="' + esc(label || placeholder) + '" data-p="' + path + '"><option value="">' + esc(placeholder) + '</option>' +
    (S.cats || []).map(g => '<optgroup label="' + esc(grpName(g)) + '">' + g.categories.map(c => '<option value="' + esc(c.id) + '"' + (value === c.id ? ' selected' : '') + '>' + esc(catName(c)) + '</option>').join('') + '</optgroup>').join('') + '</select>';
}
const budgetText = (p) => p.budget_max ? (p.budget_min ? money(p.budget_min) + ' – ' : t('upTo') + ' ') + money(p.budget_max) : t('budgetOpen');
const BIZ = ['builder', 'architect', 'developer', 'owner', 'contractor_firm'];
function partnerBadge(v) { return v && v.verified ? '<span class="pill p-green">✓ ' + esc(t('pVerified')) + '</span>' : '<span class="pill p-grey">' + esc(t('pNotVerified')) + '</span>'; }
function partnerStatsLine(p) {
  const s = p.stats || {}; const r = s.rating || {};
  return [p.city, p.experience_years ? t('yrsExp', { y: p.experience_years }) : '', p.team_size ? t('teamOf', { n: p.team_size }) : '', r.count ? '★ ' + r.avg + ' (' + r.count + ')' : t('noRatingYet'), t('projectsDone', { n: s.completed || 0 })].filter(Boolean).join(' · ');
}
function partnerCardHtml(p, extra) {
  return '<div class="li wcard" style="align-items:flex-start"><div class="av" aria-hidden="true">' + esc(initials(p.company)) + '</div><div class="grow"><div class="row" style="gap:6px"><b>' + esc(p.company) + '</b>' + partnerBadge(p.v) + '</div>' +
    '<div class="small muted">' + esc(partnerStatsLine(p)) + '</div>' +
    (p.categories && p.categories.length ? '<div class="small">' + esc(p.categories.slice(0, 4).map(catName).join(', ') + (p.categories.length > 4 ? ' +' + (p.categories.length - 4) : '')) + '</div>' : '') +
    (p.about ? '<div class="small muted">' + esc(p.about.slice(0, 160)) + '</div>' : '') + '</div>' + (extra || '') + '</div>';
}

// ----- partner sign-up / profile -----
function fillPartnerForm() {
  const p = S.me.partner; if (!p) return;
  Object.assign(S.pp, { company: p.company, contactName: p.contact_name, city: p.city, areas: p.areas, experienceYears: p.experience_years || '', teamSize: p.team_size || '', gst: p.gst, licenceNo: p.licence_no, about: p.about, cats: {} });
  p.categories.forEach(c => { S.pp.cats[c] = true; });
}
function renderPartnerProfile(editing) {
  const f = S.pp, q = (f.catQ || '').trim().toLowerCase();
  const chosen = Object.keys(f.cats).filter(k => f.cats[k]);
  let h = '<section class="card">' + (editing ? '<h2>' + esc(t('tProfile')) + '</h2>' : '<h1>' + esc(t('partnerSignupTitle')) + '</h1><span class="muted">' + esc(t('partnerSignupSub')) + '</span>') +
    '<label class="f" for="pp-co">' + esc(t('ppCompany')) + '<input id="pp-co" class="in" maxlength="120" ' + P('pp.company', f.company) + '></label>' +
    '<label class="f" for="pp-cn">' + esc(t('ppContact')) + '<input id="pp-cn" class="in" maxlength="80" ' + P('pp.contactName', f.contactName) + '></label>' +
    '<div class="grid2"><label class="f" for="pp-city">' + esc(t('ppCity')) + '<input id="pp-city" class="in" maxlength="80" ' + P('pp.city', f.city) + '></label>' +
    '<label class="f" for="pp-areas">' + esc(t('ppAreas')) + '<input id="pp-areas" class="in" maxlength="200" placeholder="' + esc(t('ppAreasPh')) + '" ' + P('pp.areas', f.areas) + '></label>' +
    '<label class="f" for="pp-exp">' + esc(t('ppExp')) + '<input id="pp-exp" class="in num" type="number" min="0" max="80" ' + P('pp.experienceYears', f.experienceYears) + '></label>' +
    '<label class="f" for="pp-team">' + esc(t('ppTeam')) + '<input id="pp-team" class="in num" type="number" min="0" ' + P('pp.teamSize', f.teamSize) + '></label>' +
    '<label class="f" for="pp-gst">' + esc(t('gst')) + '<input id="pp-gst" class="in" maxlength="20" ' + P('pp.gst', f.gst) + '></label>' +
    '<label class="f" for="pp-lic">' + esc(t('ppLicence')) + '<input id="pp-lic" class="in" maxlength="60" ' + P('pp.licenceNo', f.licenceNo) + '></label></div>' +
    '<label class="f" for="pp-about">' + esc(t('ppAbout')) + '<textarea id="pp-about" class="in ta" maxlength="1000" placeholder="' + esc(t('ppAboutPh')) + '" data-p="pp.about">' + esc(f.about || '') + '</textarea></label>' +
    '<b>' + esc(t('ppCats', { n: chosen.length })) + '</b>' +
    (chosen.length ? '<div class="chips">' + chosen.map(id => '<button type="button" class="chip sk" aria-pressed="true" data-a="ppCat" data-v="' + esc(id) + '">' + esc(catName(findCat(id))) + ' ✕</button>').join('') + '</div>' : '<span class="small muted">' + esc(t('ppCatsHelp')) + '</span>') +
    '<input id="pp-q" class="in" placeholder="' + esc(t('ppCatSearch')) + '" aria-label="' + esc(t('ppCatSearch')) + '" ' + P('pp.catQ', f.catQ) + '>' +
    '<div class="catlist">' + (S.cats || []).map(g => {
      const list = g.categories.filter(c => !q || catName(c).toLowerCase().includes(q) || c.en.toLowerCase().includes(q));
      if (!list.length) return '';
      return '<details' + (q ? ' open' : '') + '><summary>' + esc(grpName(g)) + ' <span class="muted small">(' + list.length + ')</span></summary><div class="chips">' +
        list.map(c => '<button type="button" class="chip sk" style="min-height:38px;font-size:14px" data-a="ppCat" data-v="' + esc(c.id) + '" aria-pressed="' + !!f.cats[c.id] + '">' + esc(catName(c)) + '</button>').join('') + '</div></details>';
    }).join('') + '</div>' +
    errBox() + '<button type="button" class="btn primary" data-a="savePartner">' + esc(editing ? t('save') : t('saveContinue')) + '</button></section>';
  return h;
}

// ----- partner portal -----
function renderPartner() {
  const p = S.me.partner, s = p.stats;
  let h = '<div class="stack"><section class="card hero"><div class="row"><div class="av" aria-hidden="true">' + esc(initials(p.company)) + '</div><div class="grow"><h2>' + esc(p.company) + '</h2><span class="muted small">' +
    esc(t('ppCats', { n: p.categories.length }) + ' · ' + p.city) + '</span></div>' + partnerBadge(p.vflags) + '</div>' +
    '<span class="small">' + esc((s.rating.count ? '★ ' + s.rating.avg + ' (' + s.rating.count + ') · ' : '') + t('projectsWon', { n: s.won }) + ' · ' + t('projectsDone', { n: s.completed })) + '</span></section>';
  h += tabs([['leads', t('tLeads')], ['work', t('tMyQuotes')], ['profile', t('tProfile')], ['support', t('tHelp')], ['messages', t('tMessages')]], S.ptab, 'ptab');
  if (!p.vflags.verified && S.ptab === 'leads') h += '<div class="status s-warn">' + esc(t('pVerifyNote')) + '</div>';
  if (S.ptab === 'leads') h += (S.data.leads.length ? S.data.leads.map(leadCard).join('') : empty(t('noLeads')));
  if (S.ptab === 'work') h += (S.data.pwork.length ? S.data.pwork.map(pworkCard).join('') : empty(t('noQuotes')));
  if (S.ptab === 'profile') h += renderPartnerProfile(true);
  if (S.ptab === 'support') h += renderSupport([]);
  if (S.ptab === 'messages') h += renderMessages();
  return h + '</div>';
}
function projectMeta(p) {
  return '<div class="row" style="gap:6px"><span class="pill p-blue">' + esc(catName(p.category)) + '</span>' + (p.invited === true ? '<span class="pill p-amber">' + esc(t('invitedYou')) + '</span>' : '') + '</div>' +
    '<h3>' + esc(p.title) + '</h3>' +
    '<div class="small muted">' + esc([p.client_company ? p.client_company + ' (' + t('biz_' + (p.biz_type || 'builder')) + ')' : '', p.city, p.start_date ? t('startsOn', { d: fmtDate(p.start_date) }) : '', p.duration_days ? t('daysN', { n: p.duration_days }) : ''].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="kv"><span class="small">' + esc(t('budget')) + '</span><b class="num">' + esc(budgetText(p)) + '</b></div>' +
    (p.description ? '<p class="small" style="margin:0;white-space:pre-wrap">' + esc(p.description) + '</p>' : '') +
    addressBlock({ site_address: p.site_address || p.city, site_lat: p.site_lat, site_lng: p.site_lng }, false);
}
function leadCard(p) {
  const q = p.myQuote;
  let h = '<section class="card offer">' + projectMeta(p) + '<span class="small muted">' + esc(t('quotesSoFar', { n: p.quotes })) + '</span>';
  if (q && q.status === 'submitted') h += '<div class="status s-ok">' + esc(t('yourQuote', { a: money(q.amount), d: q.days })) + '</div>';
  if (S.quoteFor === p.id) {
    h += '<div class="panel"><div class="grid2"><label class="f" for="qa">' + esc(t('quoteAmount')) + '<input id="qa" class="in num" type="number" min="1" ' + P('qf.amount', S.qf.amount) + '></label>' +
      '<label class="f" for="qd">' + esc(t('quoteDays')) + '<input id="qd" class="in num" type="number" min="1" ' + P('qf.days', S.qf.days) + '></label></div>' +
      '<label class="f" for="qn">' + esc(t('quoteNote')) + '<textarea id="qn" class="in ta" maxlength="1000" placeholder="' + esc(t('quoteNotePh')) + '" data-p="qf.note">' + esc(S.qf.note || '') + '</textarea></label>' +
      termsTick('qterms') + '<div class="row"><button type="button" class="btn primary" data-a="sendQuote" data-b="' + esc(p.id) + '"' + (S.f.qterms ? '' : ' disabled') + '>' + esc(t(q ? 'updateQuote' : 'sendQuote')) + '</button><button type="button" class="btn ghost" data-a="closeQuote">' + esc(t('cancel')) + '</button></div></div>';
  } else {
    h += '<div class="row"><button type="button" class="btn blue" data-a="openQuote" data-b="' + esc(p.id) + '">' + esc(t(q && q.status === 'submitted' ? 'changeQuote' : 'sendQuote')) + '</button>' +
      (q && q.status === 'submitted' ? '<button type="button" class="btn ghost small" data-a="withdrawQuote" data-v="' + esc(q.id) + '">' + esc(t('withdrawQuote')) + '</button>' : '') + blockBtn(p.client_id) + '</div>';
  }
  return h + '</section>';
}
function pworkCard(p) {
  const st = p.quote.status;
  const pill = { accepted: ['p-green', 'qWon'], rejected: ['p-grey', 'qLost'], submitted: ['p-amber', 'qWaiting'], withdrawn: ['p-grey', 'qWithdrawn'] }[st] || ['p-grey', st];
  let h = '<section class="card"><div class="row" style="justify-content:space-between"><span class="pill ' + pill[0] + '">' + esc(t(pill[1])) + '</span><span class="num"><b>' + money(p.quote.amount) + '</b> · ' + esc(t('daysN', { n: p.quote.days })) + '</span></div>' + projectMeta(p);
  if (st === 'accepted') {
    h += p.client_phone ? '<div class="kv"><span>' + esc(t('clientPhone')) + '</span><a class="btn blue small" href="tel:+91' + esc(p.client_phone) + '">📞 ' + esc(p.client_phone) + '</a></div>' : '';
    h += inspectionLine(p);
    if (p.rating) h += '<div class="small"><b class="stars">' + stars(p.rating.stars) + '</b> ' + (p.rating.comment ? '“' + esc(p.rating.comment) + '”' : '') + '</div>' +
      (p.rating.dispute_status === 'none' ? (S.pdisputeFor === p.id ? '<textarea class="in ta" maxlength="500" placeholder="' + esc(t('disputePh')) + '" data-p="f.disputeText">' + esc(S.f.disputeText || '') + '</textarea><div class="row"><button type="button" class="btn blue small" data-a="pSendDispute" data-v="' + esc(p.id) + '">' + esc(t('disputeSend')) + '</button><button type="button" class="btn ghost small" data-a="pNoDispute">' + esc(t('cancel')) + '</button></div>'
        : '<button type="button" class="btn ghost small" style="align-self:flex-start" data-a="pAskDispute" data-v="' + esc(p.id) + '">' + esc(t('disputeBtn')) + '</button>')
        : '<span class="pill ' + (p.rating.dispute_status === 'removed' ? 'p-green' : 'p-amber') + '">' + esc(t(p.rating.dispute_status === 'open' ? 'disputeOpen' : p.rating.dispute_status === 'removed' ? 'disputeRemoved' : 'disputeKept')) + '</span>');
  }
  return h + '</section>';
}
function inspectionLine(p) {
  const s = p.inspection_status;
  if (!s || s === 'none') return '<span class="small muted">' + esc(t('inspNone')) + '</span>';
  const m = { scheduled: ['s-warn', 'inspScheduled'], passed: ['s-ok', 'inspPassed'], issues: ['s-err', 'inspIssues'] }[s];
  return '<div class="status ' + m[0] + '">' + esc(t(m[1])) + (p.inspection_notes ? ': ' + esc(p.inspection_notes) : '') + '</div>';
}

// ----- client (builder / architect / developer / owner): Projects tab -----
function renderClientProjects() {
  const fe = S.me.projectFees || { inspection: 0, platform: 0 };
  let h = '<section class="card hero"><span class="small" style="color:var(--amber)">' + esc(t('mkTitle')) + '</span><span>' + esc(t('mkSub')) + '</span>' +
    '<div class="bill"><div class="bill-r"><span>' + esc(t('inspFee')) + '</span><span class="num">' + money(fe.inspection) + '</span></div><div class="bill-r"><span>' + esc(t('platFee')) + '</span><span class="num">' + money(fe.platform) + '</span></div>' +
    '<div class="bill-r tot"><span>' + esc(t('perAward')) + '</span><span class="num">' + money(fe.inspection + fe.platform) + '</span></div></div><span class="small muted">' + esc(t('feesNote')) + '</span></section>';
  h += '<div class="row">' + seg('mk', [['mine', t('mkMine')], ['post', t('mkPost')], ['dir', t('mkFind')]], S.f.mk) + '</div>';
  if (S.f.mk === 'post') h += renderPostProject();
  if (S.f.mk === 'dir') h += renderDirectory();
  if (S.f.mk === 'mine') h += S.data.cprojects.length ? S.data.cprojects.map(clientProjectCard).join('') : empty(t('noProjects'));
  return h;
}
function renderPostProject() {
  const f = S.np, pin = { lat: f.lat, lng: f.lng, address: f.siteAddress };
  return '<section class="card"><h2>' + esc(t('mkPost')) + '</h2>' +
    '<label class="f">' + esc(t('needWho')) + catSelect('np.categoryId', f.categoryId, t('chooseCat'), t('needWho')) + '</label>' +
    '<label class="f" for="np-t">' + esc(t('npTitle')) + '<input id="np-t" class="in" maxlength="120" placeholder="' + esc(t('npTitlePh')) + '" ' + P('np.title', f.title) + '></label>' +
    '<label class="f" for="np-d">' + esc(t('npDesc')) + '<textarea id="np-d" class="in ta" maxlength="3000" placeholder="' + esc(t('npDescPh')) + '" data-p="np.description">' + esc(f.description || '') + '</textarea></label>' +
    '<div class="grid2"><label class="f" for="np-c">' + esc(t('ppCity')) + '<input id="np-c" class="in" maxlength="80" ' + P('np.city', f.city) + '></label>' +
    '<label class="f" for="np-a">' + esc(t('siteAddress')) + '<input id="np-a" class="in" maxlength="300" ' + P('np.siteAddress', f.siteAddress) + '></label>' +
    '<label class="f" for="np-bmin">' + esc(t('budgetMin')) + '<input id="np-bmin" class="in num" type="number" min="0" ' + P('np.budgetMin', f.budgetMin) + '></label>' +
    '<label class="f" for="np-bmax">' + esc(t('budgetMax')) + '<input id="np-bmax" class="in num" type="number" min="0" ' + P('np.budgetMax', f.budgetMax) + '></label>' +
    '<label class="f" for="np-s">' + esc(t('startDate')) + '<input id="np-s" class="in" type="date" min="' + istDate(0) + '" ' + P('np.startDate', f.startDate) + '></label>' +
    '<label class="f" for="np-dur">' + esc(t('npDuration')) + '<input id="np-dur" class="in num" type="number" min="1" ' + P('np.durationDays', f.durationDays) + '></label></div>' +
    '<div class="row"><button type="button" class="btn ghost small" data-a="npLocate">📍 ' + esc(f.lat != null ? t('pinUpdate') : t('useLocation')) + '</button>' + (f.lat != null ? '<span class="pill p-green">' + esc(t('pinSet')) + '</span>' : '') + '</div>' + mapEmbed(pin, 180) +
    (S.np.invite.length ? '<div class="f"><span>' + esc(t('inviteList')) + '</span><div class="chips">' + S.np.invite.map(x => '<button type="button" class="chip" data-a="npUninvite" data-v="' + esc(x.id) + '">' + esc(x.name) + ' ✕</button>').join('') + '</div>' +
      '<button type="button" class="opt" data-a="npOnlyInvited" aria-pressed="' + !!f.onlyInvited + '"><span class="dot"></span><span><b>' + esc(t('onlyInvited')) + '</b><br><span class="small">' + esc(t('onlyInvitedSub')) + '</span></span></button></div>' : '') +
    termsTick('pterms') + errBox() + '<button type="button" class="btn primary" data-a="postProject"' + (S.f.pterms ? '' : ' disabled') + '>' + esc(t('postProject')) + '</button></section>';
}
function renderDirectory() {
  const d = S.dir;
  let h = '<section class="card"><h2>' + esc(t('mkFind')) + '</h2><div class="grid2"><label class="f">' + esc(t('needWho')) + catSelect('dir.category', d.category, t('allCats'), t('needWho')) + '</label>' +
    '<label class="f" for="dir-c">' + esc(t('ppCity')) + '<input id="dir-c" class="in" ' + P('dir.city', d.city) + '></label></div>' +
    '<div class="chips"><button type="button" class="chip" data-a="dirToggle" data-v="verified" aria-pressed="' + !!d.verified + '">✓ ' + esc(t('pVerified')) + '</button></div>' +
    '<button type="button" class="btn primary" data-a="dirSearch">' + esc(t('fSearch')) + '</button></section>';
  if (d.results) {
    const open = S.data.cprojects.filter(p => p.status === 'open');
    h += '<section class="card"><h2>' + esc(t('dirResults', { n: d.total })) + '</h2>' + (d.results.length ? '<div class="list">' + d.results.map(p => partnerCardHtml(p,
      '<div class="stack" style="gap:6px;align-items:flex-end">' + (open.length ? '<select class="in sm" aria-label="' + esc(t('inviteTo')) + '" data-invite="' + esc(p.partner_id) + '"><option value="">' + esc(t('inviteTo')) + '</option>' + open.map(x => '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>').join('') + '</select>' : '') +
      '<button type="button" class="btn ghost small" data-a="npInvite" data-v="' + esc(p.partner_id) + '" data-k="' + esc(p.company) + '">' + esc(t('inviteNew')) + '</button></div>')).join('') + '</div>' : '<p class="muted">' + esc(t('fNone')) + '</p>') +
      '<span class="small muted">' + esc(t('phoneAfterAward')) + '</span></section>';
  }
  return h;
}
function clientProjectCard(p) {
  const st = { open: ['p-amber', 'pjOpen'], awarded: ['p-green', 'pjAwarded'], completed: ['p-blue', 'pjCompleted'], cancelled: ['p-grey', 'pjCancelled'] }[p.status] || ['p-grey', p.status];
  let h = '<section class="card"><div class="row" style="justify-content:space-between"><span class="pill ' + st[0] + '">' + esc(t(st[1])) + '</span><span class="small muted">' + esc(fmtDate(p.created_at)) + '</span></div>' + projectMeta(p);
  if (p.status === 'open') h += '<span class="small muted">' + esc(t('quotesSoFar', { n: p.quotes.length }) + (p.invited ? ' · ' + t('invitedN', { n: p.invited }) : '')) + '</span>';
  if (p.quotes.length) {
    h += '<div class="list">' + p.quotes.map(q => {
      let extra = '<div class="stack qprice" style="gap:6px;align-items:flex-end;min-width:150px"><b class="num" style="font-size:20px">' + money(q.amount) + '</b><span class="small muted">' + esc(t('daysN', { n: q.days })) + '</span>';
      if (p.status === 'open') extra += S.awardConfirm === q.quote_id ? '' : '<button type="button" class="btn blue small" data-a="askAward" data-v="' + esc(q.quote_id) + '">' + esc(t('awardBtn')) + '</button>';
      if (q.status === 'accepted') extra += '<span class="pill p-green">' + esc(t('qWonClient')) + '</span>' + (q.phone ? '<a class="btn blue small" href="tel:+91' + esc(q.phone) + '">📞 ' + esc(q.phone) + '</a>' : '');
      extra += '</div>';
      let row = partnerCardHtml(q, extra) + (q.note ? '<div class="small" style="margin:-4px 0 8px 54px">“' + esc(q.note) + '”</div>' : '');
      if (S.awardConfirm === q.quote_id) {
        row += '<div class="panel"><b>' + esc(t('awardConfirmT', { c: q.company })) + '</b><div class="kv small"><span>' + esc(t('inspFee')) + '</span><span class="num">' + money(S.me.projectFees.inspection) + '</span></div>' +
          '<div class="kv small"><span>' + esc(t('platFee')) + '</span><span class="num">' + money(S.me.projectFees.platform) + '</span></div><div class="kv"><b>' + esc(t('payNow')) + '</b><b class="num">' + money(S.me.projectFees.inspection + S.me.projectFees.platform) + '</b></div>' +
          '<span class="small muted">' + esc(t('awardNote')) + '</span><div class="row"><button type="button" class="btn primary" data-a="award" data-b="' + esc(p.id) + '" data-v="' + esc(q.quote_id) + '">' + esc(t('payAward', { a: money(S.me.projectFees.inspection + S.me.projectFees.platform) })) + '</button><button type="button" class="btn ghost" data-a="noAward">' + esc(t('cancel')) + '</button></div></div>';
      }
      return row;
    }).join('') + '</div>';
  } else if (p.status === 'open') h += '<p class="small muted" style="margin:0">' + esc(t('noQuotesYet')) + '</p>';
  if (p.payment_status === 'pending' && p.status === 'open') h += '<div class="status s-warn">' + esc(t('awardPending')) + '</div>';
  if (p.status === 'awarded' || p.status === 'completed') h += inspectionLine(p);
  if (p.status === 'awarded') h += '<button type="button" class="btn ghost small" style="align-self:flex-start" data-a="completeProject" data-v="' + esc(p.id) + '">' + esc(t('markComplete')) + '</button>';
  if (p.status === 'completed') h += '<div class="row" style="gap:4px;align-items:center"><span class="small">' + esc(t('rateWorker')) + '</span>' + (p.rating && p.rating.dispute_status === 'open' ? '<span class="pill p-amber">' + esc(t('ratingUnderReview')) + '</span>' :
    [1, 2, 3, 4, 5].map(n => '<button type="button" class="star' + (p.rating && p.rating.stars >= n ? ' on' : '') + '" data-a="prate" data-b="' + esc(p.id) + '" data-v="' + n + '" aria-label="' + n + ' ★">★</button>').join('')) + '</div>';
  if (p.status === 'open') h += '<div class="row"><button type="button" class="btn ghost small" data-a="inviteMore" data-v="' + esc(p.category ? p.category.id : '') + '">' + esc(t('inviteMore')) + '</button>' + confirmBtn('pj:' + p.id, 'cancelProject', p.id, t('cancelProject')) + '</div>';
  return h + '</section>';
}

// ----- admin: marketplace -----
function renderAdminMarket(A) {
  let h = '';
  if (S.atab === 'mprojects' && A.projects) {
    const staff = A['staff-names'] || [];
    h += '<section class="card"><h2>Projects marketplace</h2><span class="small muted">Every award charges the client the inspection charge + platform fee (Prices & fees). Assign an inspector (a supervisor) to each awarded project; they record the result from "My inspections".</span>' +
      '<div class="tablebox"><table><thead><tr><th>Project</th><th>Client</th><th>Budget</th><th>Quotes</th><th>Status</th><th>Awarded to</th><th>Fees</th><th>Inspector</th><th>Inspection</th></tr></thead><tbody>' +
      (A.projects.length ? A.projects.map(p => '<tr><td><b>' + esc(p.title) + '</b><div class="small muted">' + esc(p.category_en) + ' · ' + esc(p.city) + '</div></td><td>' + esc(p.client_company) + '<div class="small muted">' + esc(p.biz_type) + ' · <span class="num">' + esc(p.client_phone) + '</span></div></td>' +
        '<td class="num">' + esc(budgetText(p)) + '</td><td class="num">' + p.quote_count + '</td><td><span class="pill p-grey">' + esc(p.status) + '</span>' + (p.payment_status === 'pending' ? '<div class="small muted">payment pending</div>' : '') + '</td>' +
        '<td>' + (p.awarded ? esc(p.awarded.company) + '<div class="small num">' + money(p.awarded.amount) + ' · ' + esc(p.awarded.phone) + '</div>' : '—') + '</td>' +
        '<td class="num">' + (p.payment_status === 'paid' ? money(p.inspection_fee + p.platform_fee) : '—') + '</td>' +
        '<td>' + (['awarded', 'completed'].includes(p.status) ? '<select class="in sm" aria-label="Inspector" data-insp="' + esc(p.id) + '"><option value="">— None —</option>' + staff.map(x => '<option value="' + esc(x.id) + '"' + (p.inspector_id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' : '—') + '</td>' +
        '<td>' + (['awarded', 'completed'].includes(p.status) ? inspectionAdmin(p) : '—') + '</td></tr>').join('') : '<tr><td colspan="9" class="muted">No projects yet.</td></tr>') + '</tbody></table></div></section>';
  }
  if (S.atab === 'myinsp' && A['my-inspections']) {
    const list = A['my-inspections'].projects;
    h += list.length ? list.map(p => '<section class="card"><h3>' + esc(p.title) + '</h3><span class="small muted">' + esc(p.category_en) + ' · ' + esc(p.city) + ' · ' + esc(p.site_address || '') + '</span>' +
      '<div class="small">Client: <b>' + esc(p.client_company) + '</b> <span class="num">' + esc(p.client_phone) + '</span>' + (p.awarded ? ' · Contractor: <b>' + esc(p.awarded.company) + '</b> <span class="num">' + esc(p.awarded.phone) + '</span>' : '') + '</div>' +
      addressBlock(p, true) + inspectionAdmin(p) + '</section>').join('') : empty('No inspections assigned to you.');
  }
  if (S.atab === 'partners' && A.partners) {
    const rows = A.partners.filter(p => matchQ(p.company, p.phone, p.city));
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>Contractors & professionals (' + A.partners.length + ')</h2><input class="in sm" style="max-width:260px" placeholder="Search name, phone, city" ' + P('q', S.q) + ' id="q-partners"></div>' +
      '<span class="small muted">"Verified" is shown to clients when documents are checked plus licence or a site visit. Tick only after checking. Set leads to verified-only in Prices & fees.</span>' +
      '<div class="tablebox"><table><thead><tr><th>Company</th><th>Categories</th><th>Experience</th><th>Licence / GST</th><th>Verification</th><th>Rating</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      (rows.length ? rows.map(p => '<tr><td><b>' + esc(p.company) + '</b><div class="small muted"><span class="num">' + esc(p.phone) + '</span> · ' + esc(p.city) + '</div></td>' +
        '<td class="small">' + esc(p.categories.map(c => c.en).slice(0, 3).join(', ') + (p.categories.length > 3 ? ' +' + (p.categories.length - 3) : '')) + '</td>' +
        '<td class="small">' + esc((p.experience_years || 0) + ' yrs · team ' + (p.team_size || 0)) + '</td><td class="small">' + esc(p.licence_no || '—') + '<div class="muted">' + esc(p.gst || '') + '</div></td>' +
        '<td style="white-space:nowrap">' + (p.v.verified ? '<span class="pill p-green">Verified</span>' : '<span class="pill p-grey">Not verified</span>') +
          [['verified_docs', 'Documents / KYC'], ['verified_licence', 'Licence / registration'], ['verified_site', 'Site / office visit']].map(x => '<label class="row small" style="gap:6px"><input type="checkbox" style="width:20px;height:20px" data-pv="' + esc(p.partner_id) + '" data-fld="' + x[0] + '"' + (p[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>').join('') +
          (p.reportsAgainst ? '<span class="pill p-red">' + p.reportsAgainst + ' open report(s)</span>' : '') + '</td>' +
        '<td class="small">' + esc(partnerStatsLine(p)) + '</td>' +
        '<td><select class="in sm" aria-label="Status" data-ps="' + esc(p.partner_id) + '"><option value="active"' + (p.status === 'active' ? ' selected' : '') + '>Active</option><option value="suspended"' + (p.status === 'suspended' ? ' selected' : '') + '>Suspended</option></select></td>' +
        '<td style="white-space:nowrap">' + (canDo('open_portals') ? '<button type="button" class="btn blue small" data-a="actAs" data-v="' + esc(p.partner_id) + '">Open</button> ' : '') + confirmBtn('pt:' + p.partner_id, 'delPartner', p.partner_id, 'Delete') + '</td></tr>').join('') : '<tr><td colspan="8" class="muted">No contractors or professionals yet.</td></tr>') + '</tbody></table></div></section>';
  }
  if (S.atab === 'categories' && A.svc) {
    const q = (S.q || '').toLowerCase();
    h += '<section class="card"><div class="row" style="justify-content:space-between"><h2>Categories (' + A.svc.groups.reduce((a, g) => a + g.categories.filter(c => c.active).length, 0) + ' active)</h2><input id="q-cats" class="in sm" style="max-width:260px" placeholder="Search categories" ' + P('q', S.q) + '></div>' +
      '<span class="small muted">Edit a name and press Enter or move to the next field to save. Untick to hide a category (existing profiles keep it). Hindi / Marathi names are optional – English is shown when empty.</span></section>';
    h += A.svc.groups.map(g => {
      const list = g.categories.filter(c => !q || c.en.toLowerCase().includes(q));
      if (q && !list.length) return '';
      return '<section class="card"><details' + (q ? ' open' : '') + '><summary><b>' + esc(g.en) + '</b> <span class="small muted">' + esc(g.hi) + ' · ' + list.length + '</span></summary>' +
        '<div class="tablebox" style="margin-top:8px"><table><thead><tr><th>English</th><th>Hindi</th><th>Marathi</th><th>Partners</th><th>Active</th></tr></thead><tbody>' +
        list.map(c => '<tr><td><input class="in sm" style="min-width:220px" aria-label="English name" data-sc="' + esc(c.id) + '" data-fld="en" value="' + esc(c.en) + '"></td><td><input class="in sm" aria-label="Hindi name" data-sc="' + esc(c.id) + '" data-fld="hi" value="' + esc(c.hi) + '"></td>' +
          '<td><input class="in sm" aria-label="Marathi name" data-sc="' + esc(c.id) + '" data-fld="mr" value="' + esc(c.mr) + '"></td><td class="num">' + c.partners + '</td><td><input type="checkbox" style="width:22px;height:22px" aria-label="Active" data-sca="' + esc(c.id) + '"' + (c.active ? ' checked' : '') + '></td></tr>').join('') +
        '</tbody></table></div><div class="row" style="align-items:flex-end;margin-top:8px"><label class="f grow">New category in this group<input id="nc-' + esc(g.id) + '" class="in sm" placeholder="e.g. Vastu Consultant"></label><button type="button" class="btn primary small" data-a="addCat" data-v="' + esc(g.id) + '">Add</button></div></details></section>';
    }).join('');
  }
  return h;
}
function inspectionAdmin(p) {
  const s = p.inspection_status || 'none';
  return '<div class="stack" style="gap:6px;min-width:220px"><span class="pill ' + (s === 'passed' ? 'p-green' : s === 'issues' ? 'p-red' : s === 'scheduled' ? 'p-amber' : 'p-grey') + '">' + esc(s) + '</span>' +
    (p.inspection_notes ? '<span class="small">' + esc(p.inspection_notes) + '</span>' : '') +
    '<input id="in-' + esc(p.id) + '" class="in sm" maxlength="1000" placeholder="What did the inspection find?"><div class="row" style="gap:6px"><button type="button" class="btn blue small" data-a="inspResult" data-v="' + esc(p.id) + '" data-k="passed">Passed</button><button type="button" class="btn danger small" data-a="inspResult" data-v="' + esc(p.id) + '" data-k="issues">Issues found</button></div></div>';
}

function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
function setPath(path, val) { const ks = path.split('.'), last = ks.pop(); const o = ks.reduce((x, k) => (x[k] = x[k] || {}), S); o[last] = val; }
const chosenKeys = (m) => Object.keys(m || {}).filter(k => m[k]);
const blankAw = () => ({ phone: '', name: '', area: '', experience: '', coupon: '', skills: {} });

// ---------- events ----------
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-a]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const a = b.getAttribute('data-a'), v = b.getAttribute('data-v'), bid = b.getAttribute('data-b');
  if (modalHandlers[a]) { modalHandlers[a](); return; }
  S.err = '';
  const simple = {
    lang: () => { S.lang = v; store('lang', v); if (S.me && S.me.user) api('POST', '/api/me/lang', { lang: v }).catch(() => {}); },
    view: () => { S.view = v; store('view', v); loadTab().then(render); },
    set: () => { const k = b.getAttribute('data-k'); S.f[k] = k === 'days' ? n0(v) : v; if ((k === 'days' || k === 'level') && S.ctab === 'book') loadAvailability().then(render); },
    toggle: () => { const k = b.getAttribute('data-k'); S.f[k] = !S.f[k]; },
    hidePick: () => { S.pick = { id: '', list: [], needed: 0 }; },
    askDecline: () => { S.confirmDecline = bid; }, keepJob: () => { S.confirmDecline = ''; },
    addQty: () => { S.f.qty[v] = S.f.qty[v] > 0 ? 0 : 1; },
    qty: () => { const k = b.getAttribute('data-k'); S.f.qty[k] = Math.max(0, Math.min(100, (S.f.qty[k] || 0) + (v === '-1' ? -1 : 1))); },
    clearPin: () => { S.f.lat = null; S.f.lng = null; },
    locate: () => {
      if (!navigator.geolocation) { toast(t('locationFailed')); return; }
      toast(t('locating'));
      navigator.geolocation.getCurrentPosition(pos => {
        S.f.lat = Math.round(pos.coords.latitude * 1e6) / 1e6; S.f.lng = Math.round(pos.coords.longitude * 1e6) / 1e6; render();
      }, () => toast(t('locationFailed')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    },
    wskill: () => { S.f.wskills[v] = !S.f.wskills[v]; },
    portal: () => { S.portal = v; store('portal', v); S.login = { phone: '', code: '', sent: false, devCode: '' }; },
    changeNumber: () => { S.login = { phone: S.login.phone, code: '', sent: false, devCode: '' }; },
    askCancel: () => { S.confirmCancel = bid; }, noCancel: () => { S.confirmCancel = ''; },
    askDel: () => { S.confirmDel = v; }, noDel: () => { S.confirmDel = ''; },
    tickTerms: () => { S.f[v] = !S.f[v]; },
    ppCat: () => { S.pp.cats[v] = !S.pp.cats[v]; },
    openQuote: () => { const l = S.data.leads.find(x => x.id === bid); const q = l && l.myQuote; S.quoteFor = bid; S.qf = { amount: q ? String(q.amount) : '', days: q ? String(q.days) : (l && l.duration_days ? String(l.duration_days) : ''), note: q ? q.note : '' }; },
    closeQuote: () => { S.quoteFor = ''; },
    askAward: () => { S.awardConfirm = v; }, noAward: () => { S.awardConfirm = ''; },
    npUninvite: () => { S.np.invite = S.np.invite.filter(x => x.id !== v); },
    npOnlyInvited: () => { S.np.onlyInvited = !S.np.onlyInvited; },
    npInvite: () => { if (!S.np.invite.some(x => x.id === v)) S.np.invite.push({ id: v, name: b.getAttribute('data-k') }); if (!S.np.categoryId) S.np.categoryId = S.dir.category; S.f.mk = 'post'; toast(t('addedToInvite')); },
    dirToggle: () => { S.dir[v] = !S.dir[v]; },
    pAskDispute: () => { S.pdisputeFor = v; S.f.disputeText = ''; }, pNoDispute: () => { S.pdisputeFor = ''; },
    showTerms: () => { showTerms(); },
    askOpen: () => { const j = S.data.jobs.find(x => x.id === bid); S.askFor = bid; S.f.ask = { wage: j ? String(j.wage + 100) : '', travel: j ? String(j.travel_per_day || 0) : '', note: '' }; },
    askClose: () => { S.askFor = ''; },
    askBlock: () => { S.confirmBlock = v; }, noBlock: () => { S.confirmBlock = ''; },
    pfToggle: () => { S.pf[v] = !S.pf[v]; }, wsToggle: () => { S.ws[v] = !S.ws[v]; },
    repUrgent: () => { S.rep.urgent = !S.rep.urgent; },
    askDispute: () => { S.disputeFor = v; S.f.disputeText = ''; }, noDispute: () => { S.disputeFor = ''; },
    removePrefer: () => { S.f.prefer = S.f.prefer.filter(p => p.id !== v); },
    panel: () => { S.panel[bid] = S.panel[bid] === v ? '' : v; if (S.panel[bid] === 'reg') { S.reg = { id: bid, data: null }; loadReg(bid).then(render).catch(e => toast(e.message)); } },
    reportFor: () => {
      Object.assign(S.rep, { bookingId: bid, category: v === 'payment' ? 'payment' : 'other', text: '', urgent: false });
      if (S.me.user.role === 'contractor') S.ctab = 'support'; else S.wtab = 'support';
      loadTab().then(render); window.scrollTo(0, 0);
    },
    toggleSkill: () => { const k = b.getAttribute('data-k'); const m = getPath(k) || {}; m[v] = !m[v]; setPath(k, m); },
    toggleForm: () => { S.formOpen[v] = !S.formOpen[v]; },
    askDelUser: () => { S.confirmDelUser = v; }, noDelUser: () => { S.confirmDelUser = ''; },
    cancelEdit: () => { S.edit = null; },
    editWorker: () => { const w = (S.admin.workers || []).find(x => x.user_id === v); if (!w) return; const sk = {}; w.skills.forEach(id => { sk[id] = true; }); S.edit = { id: v, name: w.name, phone: w.phone, area: w.area || '', experience: w.experience || '', skills: sk }; },
    editBuilder: () => { const c = (S.admin.contractors || []).find(x => x.user_id === v); if (!c) return; S.edit = { id: v, company: c.company, phone: c.phone, gst: c.gst || '' }; },
    toggleCfg: () => { const k = b.getAttribute('data-k'); S.cfgDraft = Object.assign({}, S.cfgDraft || S.admin.settings); S.cfgDraft[k] = S.cfgDraft[k] ? 0 : 1; },
  };
  if (simple[a]) { simple[a](); render(); return; }
  const tabsAct = { ctab: 'ctab', wtab: 'wtab', atab: 'atab', ptab: 'ptab' };
  if (tabsAct[a]) { S[a] = v; S.confirmDel = ''; S.confirmDelUser = ''; S.edit = null; S.q = ''; S.cfgDraft = null; if (a === 'wtab' && v === 'profile') fillWorkerForm(); if (a === 'ptab' && v === 'profile') fillPartnerForm(); render(); loadTab().then(render); return; }

  const actions = {
    sendOtp: async () => { const r = await api('POST', '/api/auth/request-otp', { phone: S.login.phone, lang: S.lang }); S.login.sent = true; S.login.devCode = r.devCode || ''; },
    verifyOtp: async () => {
      const portal = ['worker', 'contractor', 'partner'].includes(v) ? v : ['worker', 'contractor', 'partner'].includes(S.portal) ? S.portal : undefined;
      try { await api('POST', '/api/auth/verify-otp', { phone: S.login.phone, code: S.login.code, lang: S.lang, portal }); }
      catch (e) { if (e.code === 'not_registered') S.login.unreg = true; throw e; }
      S.login = { phone: '', code: '', sent: false, devCode: '' }; await refresh();
    },
    adminLogin: async () => { await api('POST', '/api/auth/admin-login', { username: S.adm.user, password: S.adm.pass }); S.adm = { open: false, user: '', pass: '' }; S.view = 'admin'; store('view', 'admin'); await refresh(); },
    actAs: async () => { await api('POST', '/api/admin/act-as', { userId: v }); S.view = 'app'; store('view', 'app'); S.ctab = 'home'; S.wtab = 'jobs'; await refresh(); },
    stopActing: async () => { await api('POST', '/api/auth/stop-acting'); S.view = 'admin'; store('view', 'admin'); await refresh(); },
    trialC: async () => { const d = n0((document.getElementById('trial-' + v) || {}).value); await api('POST', '/api/admin/contractors/' + v + '/trial', { days: d }); toast('Free trial given'); await loadTab(); },
    trialW: async () => { const d = n0((document.getElementById('trial-' + v) || {}).value); await api('POST', '/api/admin/workers/' + v + '/trial', { days: d }); toast('Free trial given'); await loadTab(); },
    logout: async () => { await api('POST', '/api/auth/logout'); S.view = 'app'; store('view', 'app'); S.portal = ''; store('portal', ''); await loadMe(); },
    chooseRole: async () => { await api('POST', '/api/me/role', { role: v }); await loadMe(); },
    saveContractor: async () => { const r = await api('POST', '/api/contractor/profile', { company: S.f.company, gst: S.f.gst, bizType: S.f.bizType, coupon: S.f.coupon || '' }); if (r.coupon) toast(t('couponApplied', { c: r.coupon.label })); S.f.coupon = ''; await refresh(); },
    saveWorker: async () => { const r = await api('POST', '/api/worker/profile', { name: S.f.wname, area: S.f.warea, experience: S.f.wexp, upiId: S.f.wupi, coupon: S.me.worker ? '' : (S.f.coupon || ''), skills: Object.keys(S.f.wskills).filter(k => S.f.wskills[k]) }); toast(r.coupon ? t('couponApplied', { c: r.coupon.label }) : t('saved')); S.f.coupon = ''; await refresh(); },
    applyCoupon: async () => { const r = await api('POST', '/api/coupon/apply', { code: S.f.couponCode || '' }); S.f.couponCode = ''; toast(t('couponApplied', { c: r.coupon.label })); await refresh(); },
    book: async () => {
      const f = S.f;
      const r = await api('POST', '/api/contractor/bookings', { lines: Object.keys(f.qty).map(k => ({ skillId: k, count: f.qty[k] })), days: f.days, level: f.level, qc: f.qc, payMode: f.pay, site: f.site, siteAddress: f.siteAddress, siteLat: f.lat, siteLng: f.lng, startDate: f.start, reportTime: f.reportTime, otRate: f.otRate === '' ? null : n0(f.otRate), preferWorkers: f.prefer.map(p => p.id), travelPerDay: n0(f.travel), acceptTerms: !!f.bterms });
      if (r.payment) { const ok = await pay(r.payment, t('tBook')); if (!ok) { S.ctab = 'bookings'; await refresh(); return; } }
      toast(t('bookingSent')); Object.assign(S.f, { qty: {}, site: '', siteAddress: '', lat: null, lng: null, prefer: [], otRate: '', travel: '' }); S.ctab = 'bookings'; await refresh();
    },
    pickWorkers: async () => { await loadPick(bid); },
    selectWorker: async () => { await api('POST', '/api/contractor/bookings/' + bid + '/select', { workerId: b.getAttribute('data-w') }); toast(t('workerSelected')); await loadTab(); if (S.pick.id && !S.pick.needed) S.pick = { id: '', list: [], needed: 0 }; },
    toggleAvail: async () => { await api('POST', '/api/worker/availability', { available: S.me.worker.available === 0 }); await refresh(); },
    checkin: async () => { await api('POST', '/api/worker/work/' + bid + '/checkin'); toast(t('checkinSent')); await loadTab(); },
    declineJob: async () => { await api('POST', '/api/worker/work/' + bid + '/decline'); S.confirmDecline = ''; toast(t('declinedToast')); await loadTab(); },
    askYes: async () => { await api('POST', '/api/contractor/counters/' + v + '/accept'); toast(t('askAcceptedToast')); await loadTab(); },
    askNo: async () => { await api('POST', '/api/contractor/counters/' + v + '/decline'); toast(t('askDeclinedToast')); await loadTab(); },
    sendAsk: async () => {
      if (!S.f.wterms) throw new Error(t('err_terms_required'));
      const a = S.f.ask;
      await api('POST', '/api/worker/jobs/' + bid + '/ask', { wage: n0(a.wage), travel: a.travel === '' ? undefined : n0(a.travel), note: a.note, acceptTerms: true });
      S.askFor = ''; toast(t('askSentToast')); await loadTab();
    },
    payBooking: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/pay'); if (await pay(r.payment, t('tBook'))) toast(t('bookingSent')); await refresh(); },
    att: async () => { await api('POST', '/api/contractor/bookings/' + bid + '/attendance', { workerId: b.getAttribute('data-w'), status: v }); await loadTab(); },
    replace: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/replace', { workerId: b.getAttribute('data-w') }); toast(r.replacedBy ? t('autoReplacedToast', { n: r.replacedBy }) : t('replaceAsked')); await loadTab(); },
    cancelBooking: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/cancel'); S.confirmCancel = ''; if (r.refundNeeded) toast(t('refundNote')); await loadTab(); },
    startPlan: async () => { const r = await api('POST', '/api/contractor/plan'); await pay(r.payment, t('planTitle')); await refresh(); },
    cancelPlan: async () => { await api('POST', '/api/contractor/plan/cancel'); await refresh(); },
    accept: async () => {
      if (!S.f.wterms) throw new Error(t('err_terms_required'));
      await api('POST', '/api/worker/jobs/' + bid + '/accept', { acceptTerms: true }); toast(t('accepted')); S.wtab = 'work'; await loadTab();
    },
    paid: async () => { await api('POST', '/api/worker/work/' + bid + '/paid', { received: v === 'yes' }); await loadTab(); },
    startMem: async () => { const r = await api('POST', '/api/worker/membership', { method: S.f.memMethod }); if (r.payment) await pay(r.payment, t('memTitle')); await refresh(); },
    cancelMem: async () => { await api('POST', '/api/worker/membership/cancel'); await refresh(); },
    saveCfg: async () => { const r = await api('PUT', '/api/admin/settings', S.cfgDraft || S.admin.settings); S.admin.settings = r.settings; S.cfgDraft = null; toast('Prices saved'); await loadMe(); },
    addSkill: async () => { await api('POST', '/api/admin/skills', { en: S.f.newEn, hi: S.f.newHi, mr: S.f.newMr, cat: S.f.newCat, wage: n0(S.f.newWage) }); Object.assign(S.f, { newEn: '', newHi: '', newMr: '', newWage: '' }); toast('Skill added'); await refresh(); },
    delSkill: async () => { await api('DELETE', '/api/admin/skills/' + v); S.confirmDel = ''; toast('Skill removed'); await refresh(); },
    addWorker: async () => { const f = S.f.aw; const r = await api('POST', '/api/admin/workers', { phone: f.phone, name: f.name, area: f.area, experience: f.experience, coupon: f.coupon, skills: chosenKeys(f.skills) }); S.f.aw = blankAw(); S.formOpen.aw = false; toast(r.coupon ? 'Worker added · ' + r.coupon.label : 'Worker added'); await loadTab(); },
    saveEditWorker: async () => { const e = S.edit; await api('PATCH', '/api/admin/workers/' + e.id, { name: e.name, phone: e.phone, area: e.area, experience: e.experience, skills: chosenKeys(e.skills) }); S.edit = null; toast('Saved'); await loadTab(); },
    delWorker: async () => { await api('DELETE', '/api/admin/workers/' + v); S.confirmDelUser = ''; toast('Worker deleted'); await loadTab(); },
    addBuilder: async () => { const f = S.f.ab; const r = await api('POST', '/api/admin/contractors', f); S.f.ab = { phone: '', company: '', gst: '', coupon: '' }; S.formOpen.ab = false; toast(r.coupon ? 'Builder added · ' + r.coupon.label : 'Builder added'); await loadTab(); },
    saveEditBuilder: async () => { const e = S.edit; await api('PATCH', '/api/admin/contractors/' + e.id, { company: e.company, phone: e.phone, gst: e.gst }); S.edit = null; toast('Saved'); await loadTab(); },
    delBuilder: async () => { await api('DELETE', '/api/admin/contractors/' + v); S.confirmDelUser = ''; toast('Builder deleted'); await loadTab(); },
    addCoupon: async () => { await api('POST', '/api/admin/coupons', S.f.cp); S.f.cp = { code: '', applies_to: 'both', kind: 'percent', value: '', max_uses: '', expires: '', note: '' }; toast('Coupon created'); await loadTab(); },
    delCoupon: async () => { await api('DELETE', '/api/admin/coupons/' + v); S.confirmDelUser = ''; toast('Coupon deleted'); await loadTab(); },
    addGroup: async () => { await api('POST', '/api/admin/staff/groups', { name: S.f.grp.name, perms: chosenKeys(S.f.grp.perms) }); S.f.grp = { name: '', perms: {} }; toast('Group created'); await loadTab(); },
    delGroup: async () => { await api('DELETE', '/api/admin/staff/groups/' + v); S.confirmDelUser = ''; toast('Group deleted'); await loadTab(); },
    addStaff: async () => { await api('POST', '/api/admin/staff/users', S.f.st); S.f.st = { name: '', username: '', password: '', phone: '', group_id: '' }; toast('Supervisor added'); await loadTab(); },
    resetPw: async () => { const el = document.getElementById('pw-' + v); await api('PATCH', '/api/admin/staff/users/' + v, { password: el ? el.value : '' }); toast('Password changed'); await loadTab(); },
    delStaff: async () => { await api('DELETE', '/api/admin/staff/users/' + v); S.confirmDelUser = ''; toast('Supervisor deleted'); await loadTab(); },
    supAtt: async () => { await api('POST', '/api/admin/my-work/' + bid + '/attendance', { workerId: b.getAttribute('data-w'), status: v }); await loadTab(); },
    fav: async () => {
      const wid = b.getAttribute('data-w'), on = v === 'on';
      await api('POST', '/api/contractor/favourites', { workerId: wid, on });
      const upd = (x) => { if (x && x.worker_id === wid) x.favourite = on; };
      (S.pick.list || []).forEach(upd); (S.ws.results || []).forEach(upd); S.data.bookings.forEach(bk => (bk.team || []).forEach(upd));
      toast(t(on ? 'favAdded' : 'favRemoved'));
    },
    blockUser: async () => {
      await api('POST', '/api/blocks', { userId: v }); S.confirmBlock = ''; toast(t('blockedToast'));
      S.pick.list = (S.pick.list || []).filter(x => x.worker_id !== v); if (S.ws.results) S.ws.results = S.ws.results.filter(x => x.worker_id !== v);
      await loadTab();
    },
    unblock: async () => { await api('DELETE', '/api/blocks/' + v); toast(t('unblockedToast')); await loadSupport(); },
    rate: async () => { await api('POST', '/api/contractor/bookings/' + bid + '/rate', { workerId: b.getAttribute('data-w'), stars: n0(v) }); toast(t('ratedToast')); await loadTab(); },
    bookAgain: async () => {
      const r = await api('GET', '/api/contractor/bookings/' + bid + '/repeat');
      const names = {}; S.data.bookings.forEach(bk => (bk.team || []).forEach(m => { names[m.worker_id] = m.name; }));
      const qty = {}; r.lines.forEach(l => { qty[l.skillId] = (qty[l.skillId] || 0) + l.count; });
      Object.assign(S.f, { qty, site: r.site, siteAddress: r.siteAddress || '', lat: r.siteLat, lng: r.siteLng, days: r.days, level: r.level, qc: r.qc, pay: r.payMode,
        reportTime: r.reportTime || '09:00', otRate: r.otRate == null ? '' : r.otRate, travel: r.travelPerDay || '', start: istDate(1), prefer: r.preferWorkers.map(id => ({ id, name: names[id] || '…' })) });
      S.ctab = 'book'; await loadAvailability(); toast(t('againToast')); window.scrollTo(0, 0);
    },
    bookTeam: async () => {
      const tm = S.data.teams.find(x => x.id === v); if (!tm) return;
      const qty = {}; tm.members.forEach(m => { qty[m.skill_id] = (qty[m.skill_id] || 0) + 1; });
      Object.assign(S.f, { qty, start: istDate(1), prefer: tm.members.map(m => ({ id: m.worker_id, name: m.name })) });
      S.ctab = 'book'; await loadAvailability(); toast(t('againToast')); window.scrollTo(0, 0);
    },
    delTeam: async () => { await api('DELETE', '/api/contractor/teams/' + v); S.confirmDelUser = ''; await loadTab(); },
    saveTeam: async () => { const r = await api('POST', '/api/contractor/teams', { name: S.f.teamName, bookingId: bid }); S.f.teamName = ''; S.panel[bid] = ''; toast(t('teamSaved', { n: r.size })); },
    sendNotice: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/notice', { text: S.f.noticeText }); S.f.noticeText = ''; S.panel[bid] = ''; toast(t('noticeSent', { n: r.sentTo })); },
    finalise: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/finalise', { workerId: b.getAttribute('data-w') }); toast(t('finalisedToast', { a: money(r.amount) })); await loadReg(bid); await loadTab(); },
    searchWorkers: async () => { await searchWorkers(); },
    sendReport: async () => {
      const r = S.rep, kind = r.category === 'payment' ? 'payment' : r.category === 'accident' ? 'incident' : 'problem';
      const out = await api('POST', '/api/reports', { kind, category: r.category, bookingId: r.bookingId || null, text: r.text, urgent: r.urgent });
      Object.assign(S.rep, { text: '', urgent: false, bookingId: '' }); toast(out.urgent ? t('reportSentUrgent') : t('reportSent')); await loadSupport();
    },
    availSet: async () => {
      if (v === 'busy') { S.f.availPick = 'busy'; S.f.busyUntil = S.f.busyUntil || istDate(3); return; }
      await api('POST', '/api/worker/availability', { status: v }); S.f.availPick = ''; toast(t('saved')); await refresh();
    },
    saveBusy: async () => { await api('POST', '/api/worker/availability', { status: 'busy', busyUntil: S.f.busyUntil }); S.f.availPick = ''; toast(t('saved')); await refresh(); },
    dayOff: async () => {
      const C = S.data.calendar, off = C.off.includes(v);
      await api('POST', '/api/worker/calendar', { date: v, off: !off });
      C.off = off ? C.off.filter(d => d !== v) : C.off.concat(v);
    },
    setHome: async () => {
      if (!navigator.geolocation) throw new Error(t('locationFailed'));
      toast(t('locating'));
      const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, () => fail(new Error(t('locationFailed'))), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
      await api('POST', '/api/worker/location', { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5, radiusKm: S.me.worker.radius_km || 15 });
      toast(t('homeSaved')); await refresh();
    },
    setRadius: async () => { await api('POST', '/api/worker/location', { radiusKm: n0(v), keepLocation: true }); toast(t('saved')); await refresh(); },
    confirmJob: async () => {
      const job = S.data.work.find(x => x.id === bid);
      if (job && !job.terms_ok && !S.f.wterms) throw new Error(t('err_terms_required'));
      await api('POST', '/api/worker/work/' + bid + '/confirm', { acceptTerms: !!S.f.wterms }); toast(t('confirmedToast')); await loadTab();
    },
    sendDispute: async () => { await api('POST', '/api/worker/ratings/' + v + '/dispute', { text: S.f.disputeText }); S.disputeFor = ''; S.f.disputeText = ''; toast(t('disputeSentToast')); await loadTab(); },
    resolveRep: async () => {
      const el = document.getElementById('res-' + v);
      await api('POST', '/api/admin/reports/' + v + '/resolve', { resolution: el ? el.value : '', ratingAction: b.getAttribute('data-k') || undefined });
      toast('Resolved'); await loadTab(); S.admin.overview = await api('GET', '/api/admin/overview');
    },
    supNotice: async () => { const el = document.getElementById('sn-' + v); const r = await api('POST', '/api/admin/bookings/' + v + '/notice', { text: el ? el.value : '' }); toast('Sent to ' + r.sentTo + ' workers'); },
    savePartner: async () => {
      await loadCats();
      const f = S.pp;
      await api('POST', '/api/partner/profile', { company: f.company, contactName: f.contactName, city: f.city, areas: f.areas, experienceYears: n0(f.experienceYears), teamSize: n0(f.teamSize), gst: f.gst, licenceNo: f.licenceNo, about: f.about, categories: Object.keys(f.cats).filter(k => f.cats[k]) });
      toast(t('saved')); S.ptab = 'leads'; await refresh();
    },
    sendQuote: async () => {
      if (!S.f.qterms) throw new Error(t('err_terms_required'));
      await api('POST', '/api/partner/projects/' + bid + '/quote', { amount: n0(S.qf.amount), days: n0(S.qf.days), note: S.qf.note, acceptTerms: true });
      S.quoteFor = ''; toast(t('quoteSent')); await loadTab();
    },
    withdrawQuote: async () => { await api('POST', '/api/partner/quotes/' + v + '/withdraw'); toast(t('quoteWithdrawn')); await loadTab(); },
    pSendDispute: async () => { await api('POST', '/api/partner/ratings/' + v + '/dispute', { text: S.f.disputeText }); S.pdisputeFor = ''; toast(t('disputeSentToast')); await loadTab(); },
    postProject: async () => {
      if (!S.f.pterms) throw new Error(t('err_terms_required'));
      const f = S.np;
      const r = await api('POST', '/api/client/projects', { categoryId: f.categoryId, title: f.title, description: f.description, city: f.city, siteAddress: f.siteAddress, siteLat: f.lat, siteLng: f.lng,
        budgetMin: f.budgetMin === '' ? null : n0(f.budgetMin), budgetMax: f.budgetMax === '' ? null : n0(f.budgetMax), startDate: f.startDate || null, durationDays: f.durationDays === '' ? null : n0(f.durationDays),
        invite: f.invite.map(x => x.id), invitedOnly: f.onlyInvited, acceptTerms: true });
      S.np = { categoryId: '', title: '', description: '', city: '', siteAddress: '', lat: null, lng: null, budgetMin: '', budgetMax: '', startDate: '', durationDays: '', invite: [], onlyInvited: false };
      S.f.mk = 'mine'; toast(t('projectPosted', { n: r.notified })); await loadTab();
    },
    npLocate: async () => {
      if (!navigator.geolocation) throw new Error(t('locationFailed'));
      const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, () => fail(new Error(t('locationFailed'))), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
      S.np.lat = Math.round(pos.coords.latitude * 1e6) / 1e6; S.np.lng = Math.round(pos.coords.longitude * 1e6) / 1e6;
    },
    dirSearch: async () => {
      const q = new URLSearchParams(); if (S.dir.category) q.set('category', S.dir.category); if (S.dir.city) q.set('city', S.dir.city); if (S.dir.verified) q.set('verified', '1');
      const r = await api('GET', '/api/client/partners?' + q.toString()); S.dir.results = r.partners; S.dir.total = r.total;
    },
    inviteMore: async () => { S.f.mk = 'dir'; S.dir.category = v; const r = await api('GET', '/api/client/partners?category=' + encodeURIComponent(v)); S.dir.results = r.partners; S.dir.total = r.total; },
    award: async () => {
      const r = await api('POST', '/api/client/projects/' + bid + '/award', { quoteId: v });
      S.awardConfirm = '';
      if (r.payment) { const ok = await pay(r.payment, t('awardBtn')); if (!ok) { await loadTab(); return; } }
      toast(t('awardDone')); await loadTab();
    },
    completeProject: async () => { await api('POST', '/api/client/projects/' + v + '/complete'); toast(t('saved')); await loadTab(); },
    cancelProject: async () => { await api('POST', '/api/client/projects/' + v + '/cancel'); S.confirmDelUser = ''; toast(t('saved')); await loadTab(); },
    prate: async () => { await api('POST', '/api/client/projects/' + bid + '/rate', { stars: n0(v) }); toast(t('ratedToast')); await loadTab(); },
    addCat: async () => { const el = document.getElementById('nc-' + v); await api('POST', '/api/admin/svc/categories', { group_id: v, en: el ? el.value : '' }); toast('Category added'); S.cats = null; await loadTab(); },
    delPartner: async () => { await api('DELETE', '/api/admin/partners/' + v); S.confirmDelUser = ''; toast('Deleted'); await loadTab(); },
    inspResult: async () => { const el = document.getElementById('in-' + v); await api('POST', '/api/admin/projects/' + v + '/inspection', { status: b.getAttribute('data-k'), notes: el ? el.value : '' }); toast('Inspection saved – client and contractor told on WhatsApp'); await loadTab(); },
    cashReceived: async () => { await api('POST', '/api/admin/workers/' + v + '/cash-received'); toast('Membership activated'); await loadTab(); },
  };
  if (actions[a]) act(actions[a]);
});
document.addEventListener('input', (ev) => {
  const el = ev.target;
  const lf = el.getAttribute('data-lf'); if (lf) { S.login[lf] = el.value; return; }
  const af = el.getAttribute('data-af'); if (af) { S.adm[af] = el.value; return; }
  const pp = el.getAttribute('data-p'); if (pp && el.tagName !== 'SELECT') { setPath(pp, el.value); if (pp === 'q' || pp.startsWith('pf.') || pp === 'pp.catQ') render(); return; }
  const k = el.getAttribute('data-f'); if (k) { S.f[k] = el.value; if (k === 'travel') render(); return; }
  const c = el.getAttribute('data-cfg'); if (c) { S.cfgDraft = Object.assign({}, S.cfgDraft || S.admin.settings); S.cfgDraft[c] = n0(el.value); }
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  const k = el.getAttribute('data-f'); if (k) { S.f[k] = el.value; if (k === 'start') loadAvailability().then(render); else if (k === 'siteAddress') render(); return; }
  const pp = el.getAttribute('data-p'); if (pp) { setPath(pp, el.value); if (el.tagName === 'SELECT') render(); return; }
  const np = el.getAttribute('data-np'); if (np) { S.f.grp.perms[np] = el.checked; return; }
  const terms = el.getAttribute('data-terms'); if (terms) {
    const bk = el.getAttribute('data-b');
    act(async () => { await api('PATCH', '/api/contractor/bookings/' + bk + '/terms', { [terms]: terms === 'otRate' ? (el.value === '' ? null : n0(el.value)) : el.value }); toast(t('saved')); await loadReg(bk); await loadTab(); }); return;
  }
  const rg = el.getAttribute('data-reg') || el.getAttribute('data-ot');
  if (rg) {
    const wid = el.getAttribute('data-w'), d = el.getAttribute('data-d');
    const cur = S.reg && S.reg.data ? ((S.reg.data.team.find(m => m.worker_id === wid) || {}).days || {})[d] || {} : {};
    const body = el.hasAttribute('data-reg') ? { workerId: wid, date: d, status: el.value } : { workerId: wid, date: d, status: cur.status || 'present', otHours: el.value === '' ? 0 : Number(el.value) };
    if (!body.status) return;
    act(async () => { await api('POST', '/api/contractor/bookings/' + rg + '/attendance', body); await loadReg(rg); await loadTab(); }); return;
  }
  const inv = el.getAttribute('data-invite'); if (inv && el.value) { const pid = el.value; act(async () => { const r = await api('POST', '/api/client/projects/' + pid + '/invite', { partnerIds: [inv] }); toast(t('invitedToast', { n: r.invited })); await loadTab(); }); return; }
  const insp = el.getAttribute('data-insp'); if (insp) { act(async () => { await api('POST', '/api/admin/projects/' + insp + '/inspector', { staffId: el.value }); toast('Inspector assigned'); await loadTab(); }); return; }
  const pv = el.getAttribute('data-pv'); if (pv) { act(async () => { await api('PATCH', '/api/admin/partners/' + pv, { [el.getAttribute('data-fld')]: el.checked }); toast('Saved'); await loadTab(); }); return; }
  const ps = el.getAttribute('data-ps'); if (ps) { act(async () => { await api('PATCH', '/api/admin/partners/' + ps, { status: el.value }); toast('Saved'); await loadTab(); }); return; }
  const sc = el.getAttribute('data-sc'); if (sc) { act(async () => { await api('PATCH', '/api/admin/svc/categories/' + sc, { [el.getAttribute('data-fld')]: el.value }); toast('Saved'); S.cats = null; }); return; }
  const sca = el.getAttribute('data-sca'); if (sca) { act(async () => { await api('PATCH', '/api/admin/svc/categories/' + sca, { active: el.checked }); toast('Saved'); S.cats = null; await loadTab(); }); return; }
  const cv = el.getAttribute('data-cv'); if (cv) { act(async () => { await api('PATCH', '/api/admin/contractors/' + cv, { [el.getAttribute('data-fld')]: el.checked }); toast('Saved'); await loadTab(); }); return; }
  const cpa = el.getAttribute('data-cpa'); if (cpa) { act(async () => { await api('PATCH', '/api/admin/coupons/' + cpa, { active: el.checked }); toast('Saved'); await loadTab(); }); return; }
  const gp = el.getAttribute('data-gp'); if (gp) {
    const g = ((S.admin.staff || {}).groups || []).find(x => x.id === gp); if (!g) return;
    const perm = el.getAttribute('data-perm'), perms = g.perms.filter(p => p !== perm).concat(el.checked ? [perm] : []);
    act(async () => { await api('PATCH', '/api/admin/staff/groups/' + gp, { perms }); toast('Permissions saved'); await loadTab(); }); return;
  }
  const sg = el.getAttribute('data-sg'); if (sg) { act(async () => { await api('PATCH', '/api/admin/staff/users/' + sg, { group_id: el.value }); toast('Saved'); await loadTab(); }); return; }
  const sa = el.getAttribute('data-sa'); if (sa) { act(async () => { await api('PATCH', '/api/admin/staff/users/' + sa, { active: el.checked }); toast('Saved'); await loadTab(); }); return; }
  const sup = el.getAttribute('data-sup'); if (sup) { act(async () => { await api('POST', '/api/admin/bookings/' + sup + '/supervisor', { staffId: el.value }); toast('Supervisor assigned'); await loadTab(); }); return; }
  const cp = el.getAttribute('data-cp'), wp = el.getAttribute('data-wp');
  if (cp || wp) { act(async () => { await api('POST', '/api/admin/' + (cp ? 'contractors/' + cp : 'workers/' + wp) + '/price', { price: el.value === '' ? null : n0(el.value) }); toast('Special price saved'); await loadTab(); }); return; }
  const sk = el.getAttribute('data-sk'), wk = el.getAttribute('data-wk'), fld = el.getAttribute('data-fld');
  if (sk && fld) act(async () => { await api('PATCH', '/api/admin/skills/' + sk, { [fld]: fld === 'wage' ? n0(el.value) : el.value }); toast('Saved'); await refresh(); });
  if (wk && fld) act(async () => {
    const val = el.type === 'checkbox' ? el.checked : fld === 'custom_wage' ? (el.value === '' ? null : n0(el.value)) : el.value;
    await api('PATCH', '/api/admin/workers/' + wk, { [fld]: val }); toast('Saved'); await loadTab();
  });
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.matches('[data-sk],[data-wk],[data-cp],[data-wp],[data-sc]')) ev.target.blur();
  if (ev.target.id === 'l-phone') document.querySelector('[data-a="sendOtp"]').click();
  if (ev.target.id === 'a-pass') document.querySelector('[data-a="adminLogin"]').click();
  if (ev.target.id === 'l-code') document.querySelector('[data-a="verifyOtp"]').click();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && (S.me.user || S.me.adminSession)) refresh(); });
setInterval(() => { if (!document.hidden && S.me && (S.me.user || S.me.adminSession) && !S.busy && !document.querySelector('.modal') && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) loadTab().then(render); }, 30000);

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
refresh().catch(e => { document.getElementById('app').innerHTML = '<div class="empty" style="margin-top:24px"><p style="margin:0">' + esc(e.message) + '</p></div>'; });
})();
