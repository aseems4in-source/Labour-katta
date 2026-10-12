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
  f: { cat: 'skilled', skillId: '', count: 4, days: 5, level: 'any', qc: false, pay: 'lk', site: '', start: '',
       company: '', gst: '', wname: '', warea: '', wexp: '1-3', wupi: '', wcat: 'skilled', wskills: {}, memMethod: 'upi',
       newEn: '', newHi: '', newMr: '', newCat: 'skilled', newWage: '' },
  data: { bookings: [], jobs: [], work: [], messages: [] }, admin: {},
  cfgDraft: null, confirmCancel: '', confirmDel: '', err: '', busy: false,
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
  try { await fn(); } catch (e) { S.err = e.message; toast(e.message); } finally { S.busy = false; render(); }
}

// ---------- data loading ----------
async function loadMe() { S.me = await api('GET', '/api/me'); if (S.me.user && S.me.user.lang && !store('lang')) S.lang = S.me.user.lang; }
async function loadTab() {
  const u = S.me && S.me.user; if (!u && !isAdmin()) return;
  try {
    if ((S.view === 'admin' || !u) && isAdmin()) {
      const map = { overview: ['overview'], pricing: ['settings'], skills: ['skills'], workers: ['workers', 'skills'], contractors: ['contractors'], bookings: ['bookings'], payments: ['payments'], outbox: ['notifications'] };
      for (const k of map[S.atab] || []) {
        const r = await api('GET', '/api/admin/' + k);
        S.admin[k] = k === 'overview' ? r : r[k];
      }
    } else if (u.role === 'contractor' && S.me.contractor) {
      if (['home', 'bookings'].includes(S.ctab)) S.data.bookings = (await api('GET', '/api/contractor/bookings')).bookings;
      if (S.ctab === 'messages') S.data.messages = (await api('GET', '/api/messages')).messages;
    } else if (u.role === 'worker' && S.me.worker) {
      if (S.wtab === 'jobs') S.data.jobs = (await api('GET', '/api/worker/jobs')).jobs;
      if (['work', 'earn'].includes(S.wtab)) S.data.work = (await api('GET', '/api/worker/work')).work;
      if (S.wtab === 'messages') S.data.messages = (await api('GET', '/api/messages')).messages;
    }
  } catch (e) { toast(e.message); }
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
}

// ---------- screens ----------
function renderLogin() {
  const L = S.login;
  let h = '<div class="login stack"><div class="row"><div class="mark" aria-hidden="true">LK</div><div><h1>Labour Katta</h1><span class="muted">' + esc(t('tagline')) + '</span></div></div>';
  if (!S.portal) {
    return h + '<h2>' + esc(t('choosePortal')) + '</h2>' +
      opt('portal', 'portal', 'contractor', false, t('portalContractor'), t('portalContractorSub')) +
      opt('portal', 'portal', 'worker', false, t('portalWorker'), t('portalWorkerSub')) +
      opt('portal', 'portal', 'admin', false, t('portalAdmin'), t('portalAdminSub')) + '</div>';
  }
  const title = S.portal === 'admin' ? t('portalAdmin') : S.portal === 'worker' ? t('portalWorker') : t('portalContractor');
  h += '<div class="row" style="justify-content:space-between"><h2>' + esc(title) + '</h2><button type="button" class="btn ghost small" data-a="portal" data-v="">← ' + esc(t('back')) + '</button></div><section class="card">';
  if (S.portal === 'admin') {
    h += '<label class="f" for="a-user">' + esc(t('username')) + '<input id="a-user" class="in" autocomplete="username" autocapitalize="off" data-af="user" value="' + esc(S.adm.user) + '"></label>' +
      '<label class="f" for="a-pass">' + esc(t('password')) + '<input id="a-pass" class="in" type="password" autocomplete="current-password" data-af="pass" value="' + esc(S.adm.pass) + '"></label>' +
      errBox() + '<button type="button" class="btn blue" data-a="adminLogin">' + esc(t('verify')) + '</button>';
  } else if (!L.sent) {
    h += '<label class="f" for="l-phone">' + esc(t('phoneLabel')) + '<input id="l-phone" class="in" type="tel" inputmode="numeric" autocomplete="tel" maxlength="14" data-lf="phone" value="' + esc(L.phone) + '" placeholder="' + esc(t('phonePh')) + '"></label>' +
      errBox() + '<button type="button" class="btn primary" data-a="sendOtp">' + esc(t('sendCode')) + '</button>';
  } else {
    h += '<p style="margin:0">' + esc(t('codeSent')) + '</p>' + (L.devCode ? '<div class="status s-warn">' + esc(t('testCode', { c: L.devCode })) + '</div>' : '') +
      '<label class="f" for="l-code">' + esc(t('codeLabel')) + '<input id="l-code" class="in num" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-lf="code" value="' + esc(L.code) + '"></label>' +
      errBox() + '<button type="button" class="btn primary" data-a="verifyOtp">' + esc(t('verify')) + '</button>' +
      '<div class="row"><button type="button" class="btn ghost small" data-a="changeNumber">' + esc(t('changeNumber')) + '</button><button type="button" class="btn ghost small" data-a="sendOtp">' + esc(t('resend')) + '</button></div>';
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
    '<label class="f" for="c-name">' + esc(t('companyName')) + '<input id="c-name" class="in" data-f="company" value="' + esc(S.f.company) + '" maxlength="120"></label>' +
    '<label class="f" for="c-gst">' + esc(t('gst')) + '<input id="c-gst" class="in" data-f="gst" value="' + esc(S.f.gst) + '" maxlength="20"></label>' +
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
    errBox() + '<button type="button" class="btn primary" data-a="saveWorker">' + esc(editing ? t('save') : t('saveContinue')) + '</button></section>';
}

// ----- contractor -----
function quote() {
  const f = S.f, s = settings(), sk = S.me.skills.find(x => x.id === f.skillId), c = S.me.contractor;
  if (!sk) return null;
  const bonus = f.level === 'gold' ? s.gold_bonus : f.level === 'silver' ? s.silver_bonus : 0;
  const wage = sk.wage + bonus, price = wage + s.margin_per_worker_day, qcCost = f.qc ? s.qc_per_day * f.days : 0;
  const jobFee = c && c.access ? 0 : s.job_fee;
  return { sk, wage, price, qcCost, jobFee, total: price * f.count * f.days + qcCost + jobFee, feeNow: jobFee + qcCost, wagesYou: wage * f.count * f.days };
}
function statusPill(b) {
  const m = { pending_payment: ['p-red', 'stPending'], open: ['p-amber', 'stOpen'], assigned: ['p-green', 'stAssigned'], cancelled: ['p-grey', 'stCancelled'] }[b.status] || ['p-grey', b.status];
  return '<span class="pill ' + m[0] + '">' + esc(t(m[1])) + '</span>';
}
function bookingCard(b) {
  let h = '<section class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(b.count) + ' × ' + esc(bSkill(b)) + '</h3>' + statusPill(b) + '</div>' +
    '<span class="muted small">' + esc(b.site) + ' · ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' ' + esc(t('daysW')) + ' · ' + esc(t('assignedOf', { a: b.team.length, n: b.count })) + '</span>' +
    '<div class="kv small"><span>' + esc(b.pay_mode === 'lk' ? t('payLK') : t('payDirect')) + '</span><b class="num">' + money(b.amount_due) + '</b></div>';
  if (b.status === 'pending_payment') h += '<button type="button" class="btn primary" data-a="payBooking" data-b="' + esc(b.id) + '">' + esc(t('payPending')) + ' · ' + money(b.amount_due) + '</button>';
  if (b.team.length && b.status !== 'cancelled') {
    h += '<div><b class="small">' + esc(t('attendance')) + '</b><div class="list">' + b.team.map(w => {
      return '<div class="li" style="flex-wrap:wrap"><div class="av" aria-hidden="true">' + esc(initials(w.name)) + '</div><div class="grow"><b>' + esc(w.name) + '</b><div class="small muted">' + esc(t(w.tier)) + ' · <span class="num">' + esc(w.phone) + '</span></div></div>' +
        '<div class="chips" role="group" aria-label="' + esc(t('attendance') + ' ' + w.name) + '">' + ['present', 'late', 'absent'].map(x => '<button type="button" class="chip" style="min-height:40px;font-size:14px" data-a="att" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '" data-v="' + x + '" aria-pressed="' + (w.today === x) + '">' + esc(t(x)) + '</button>').join('') + '</div>' +
        (w.today === 'absent' ? '<button type="button" class="btn blue small" data-a="replace" data-b="' + esc(b.id) + '" data-w="' + esc(w.worker_id) + '">' + esc(t('replace')) + '</button>' : '') + '</div>';
    }).join('') + '</div></div>';
  }
  if (b.status !== 'cancelled') {
    h += S.confirmCancel === b.id
      ? '<div class="row"><button type="button" class="btn danger small" data-a="cancelBooking" data-b="' + esc(b.id) + '">' + esc(t('confirmCancel')) + '</button><button type="button" class="btn ghost small" data-a="noCancel">' + esc(t('keep')) + '</button></div>'
      : '<button type="button" class="btn ghost small" style="align-self:flex-start" data-a="askCancel" data-b="' + esc(b.id) + '">' + esc(t('cancelBooking')) + '</button>';
  }
  return h + '</section>';
}
function renderBook() {
  const f = S.f, list = S.me.skills.filter(s => s.cat === f.cat);
  if (!list.find(s => s.id === f.skillId) && list[0]) f.skillId = list[0].id;
  if (!f.start || f.start < istDate(0)) f.start = istDate(1);
  const q = quote();
  let h = '<section class="card"><h2>' + esc(t('whichWork')) + '</h2>' + seg('cat', [['skilled', t('skilled')], ['unskilled', t('unskilled')]], f.cat) +
    '<div class="chips">' + list.map(s => '<button type="button" class="chip sk" data-a="set" data-k="skillId" data-v="' + esc(s.id) + '" aria-pressed="' + (s.id === f.skillId) + '">' + esc(skillName(s)) + '</button>').join('') + '</div>' +
    (q ? '<span class="small muted num">' + money(f.pay === 'lk' ? q.price : q.wage) + ' ' + esc(t('perDay')) + '</span>' : '') + '</section>';
  h += '<section class="card"><div class="row" style="justify-content:space-between"><span style="font-weight:600">' + esc(t('howMany')) + '</span>' +
    '<div class="stepper"><button type="button" data-a="count" data-v="-1" aria-label="−1">−</button><output class="num">' + f.count + '</output><button type="button" data-a="count" data-v="1" aria-label="+1">+</button></div></div>' +
    '<label class="f" for="b-site">' + esc(t('site')) + '<input id="b-site" class="in" data-f="site" value="' + esc(f.site) + '" placeholder="' + esc(t('sitePh')) + '" maxlength="160"></label>' +
    '<div class="grid2"><label class="f" for="b-start">' + esc(t('startDate')) + '<input id="b-start" class="in" type="date" data-f="start" value="' + esc(f.start) + '" min="' + istDate(0) + '"></label>' +
    '<div class="f"><span>' + esc(t('days')) + '</span>' + seg('days', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [15, '15'], [30, '30']], f.days) + '</div></div>' +
    '<div class="f"><span>' + esc(t('level')) + '</span>' + seg('level', [['any', t('lvAny')], ['silver', t('lvSilver')], ['gold', t('lvGold')]], f.level) + '</div>' +
    '<button type="button" class="opt" data-a="toggle" data-k="qc" aria-pressed="' + f.qc + '"><span class="dot"></span><span><b>' + esc(t('addQc')) + '</b><br><span class="small muted num">' + money(settings().qc_per_day) + esc(t('perDayShort')) + '</span></span></button></section>';
  h += '<section class="card"><h2>' + esc(t('howPay')) + '</h2>' + opt('set', 'pay', 'lk', f.pay === 'lk', t('payLK'), t('payLKSub')) + opt('set', 'pay', 'direct', f.pay === 'direct', t('payDirect'), t('payDirectSub')) + '</section>';
  if (q) {
    h += '<section class="card hero">' + (f.pay === 'lk'
      ? '<div class="kv"><span class="muted">' + esc(t('estTotal')) + '</span><span class="big num">' + money(q.total) + '</span></div>'
      : '<div class="kv"><span class="muted">' + esc(t('payNow')) + '</span><span class="big num">' + money(q.feeNow) + '</span></div><div class="kv"><span class="muted">' + esc(t('wagesYou')) + '</span><b class="num">' + money(q.wagesYou) + '</b></div>') +
      '<span class="small muted">' + f.count + ' × ' + esc(skillName(q.sk)) + ' · ' + f.days + ' ' + esc(t('daysW')) + ' · ' + esc(q.jobFee ? t('jobFeeIncl', { f: money(q.jobFee) }) : t('noJobFee')) + '</span>' +
      errBox() + '<button type="button" class="btn primary wide" data-a="book"' + (S.busy ? ' disabled' : '') + '>' + esc(t('confirm')) + '</button></section>';
  }
  return h;
}
function renderMessages() {
  const live = S.me.integrations.whatsapp === 'live';
  return '<section class="card"><h2>' + esc(t('waTitle')) + '</h2><p class="small muted" style="margin:0">' + esc(live ? t('waNoteLive') : t('waNoteTest')) + '</p>' +
    (S.data.messages.length ? S.data.messages.map(m => '<div class="msg"><div>' + esc(m.body) + '</div><div class="small muted num">' + esc(fmtTime(m.created_at)) + '</div></div>').join('') : '<p class="muted" style="margin:0">' + esc(t('noMessages')) + '</p>') + '</section>';
}
function renderActivate(c, s) {
  const p = money(c.planPrice);
  return '<div class="stack"><h1>' + esc(c.company) + '</h1>' +
    '<section class="card hero"><span class="small" style="color:var(--amber)">' + esc(t('activateTitle')) + '</span><span class="big num">' + p + '</span><span>' + esc(t('activateBody', { p })) + '</span></section>' +
    '<section class="card"><p style="margin:0">' + esc(t('planNoFee', { f: money(s.job_fee) })) + '</p>' +
    (c.custom_price != null ? '<div class="status s-ok">' + esc(t('specialPrice', { p })) + '</div>' : '') +
    (c.plan_status === 'trial' ? '<div class="status s-warn">' + esc(t('trialEnded')) + '</div>' : '') +
    errBox() + '<button type="button" class="btn primary" data-a="startPlan">' + esc(t('activateBtn', { p })) + '</button>' +
    '<span class="small muted">' + esc(t('offerNote')) + '</span></section></div>';
}
function renderContractor() {
  const c = S.me.contractor, s = settings();
  if (!c.access) return renderActivate(c, s);
  let h = '<div class="stack">' + tabs([['home', t('tHome')], ['book', t('tBook')], ['bookings', t('tBookings')], ['plan', t('tPlan')], ['messages', t('tMessages')]], S.ctab, 'ctab');
  const live = S.data.bookings.filter(b => b.status !== 'cancelled');
  if (S.ctab === 'home') {
    if (c.plan_status === 'trial') h += '<div class="status s-ok">' + esc(t('trialUntil', { d: fmtDate(c.trial_until) })) + '</div>';
    h += '<h1>' + esc(c.company) + '</h1><div class="grid3"><section class="card hero"><span class="muted small">' + esc(t('active')) + '</span><span class="big num">' + live.length + '</span></section>' +
      '<section class="card"><span class="muted small">' + esc(t('assignedWorkers')) + '</span><span class="big num">' + live.reduce((a, b) => a + b.team.length, 0) + '</span></section>' +
      '<section class="card"><span class="muted small">' + esc(t('planLbl')) + '</span><span class="pill ' + (c.access ? 'p-green' : 'p-grey') + '" style="align-self:flex-start">' + esc(c.plan_status === 'trial' ? t('trialUntil', { d: fmtDate(c.trial_until) }) : c.access ? t('planOn') : t('planOff')) + '</span></section></div>' +
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
  if (S.ctab === 'messages') h += renderMessages();
  return h + '</div>';
}

// ----- worker -----
function renderWorker() {
  const w = S.me.worker, s = settings();
  const v = [['vAadhaar', w.verified_aadhaar], ['vPhoto', w.verified_photo], ['vBank', w.verified_bank], ['vTest', w.verified_test]];
  let h = '<div class="stack"><section class="card hero"><div class="row"><div class="av" aria-hidden="true">' + esc(initials(w.name)) + '</div><div class="grow"><h2>' + esc(w.name) + '</h2><span class="muted small">' + esc(w.skills.map(id => skillName(S.me.skills.find(x => x.id === id))).join(', ')) + '</span></div><span class="pill p-amber">' + esc(t(w.tier)) + '</span></div></section>';
  h += tabs([['jobs', t('tJobs')], ['work', t('tWork')], ['earn', t('tEarn')], ['member', t('tMember')], ['profile', t('tProfile')], ['messages', t('tMessages')]], S.wtab, 'wtab');
  const member = w.access;
  if (S.wtab === 'jobs') {
    if (!member) h += '<div class="empty"><p style="margin:0">' + esc(t('needMember')) + '</p><button type="button" class="btn primary" data-a="wtab" data-v="member">' + esc(t('startMem')) + '</button></div>';
    else h += S.data.jobs.length ? S.data.jobs.map(b => '<section class="card offer"><h3>' + esc(bSkill(b)) + '</h3><span class="small">' + esc(b.site) + ' · ' + esc(t('starts')) + ' ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' ' + esc(t('daysW')) + '</span>' +
      '<div class="kv"><span class="big num">' + money(b.wage) + '<span class="small muted">' + esc(t('perDayShort')) + '</span></span><span class="pill p-blue">' + esc(t('needed', { n: b.needed })) + '</span></div>' +
      '<span class="small" style="color:var(--green-ink)">' + esc(b.pay_mode === 'lk' ? t('paidLK') : t('paidDirect')) + '</span>' +
      '<button type="button" class="btn blue wide" data-a="accept" data-b="' + esc(b.id) + '">' + esc(t('accept')) + '</button></section>').join('') : empty(t('noJobs'));
  }
  if (S.wtab === 'work') {
    h += S.data.work.length ? S.data.work.map(b => '<section class="card"><h3>' + esc(bSkill(b)) + '</h3><span class="small muted">' + esc(b.site) + ' · ' + esc(fmtDate(b.start_date)) + ' · ' + esc(b.days) + ' ' + esc(t('daysW')) + '</span>' +
      '<div class="kv small"><span>' + esc(t('contractorLbl')) + ': ' + esc(b.company) + '</span><span class="num">' + esc(b.contractor_phone) + '</span></div>' +
      '<span class="small">' + esc(b.pay_mode === 'lk' ? t('paidLK') : t('paidDirect')) + '</span>' +
      (b.pay_mode === 'direct' ? (b.paid_confirmation ? '<div class="status ' + (b.paid_confirmation === 'yes' ? 's-ok' : 's-err') + '">' + esc(b.paid_confirmation === 'yes' ? t('saidYes') : t('saidNo')) + '</div>'
        : '<b class="small">' + esc(t('gotPaid')) + '</b><div class="grid2"><button type="button" class="btn danger small" data-a="paid" data-b="' + esc(b.id) + '" data-v="no">' + esc(t('no')) + '</button><button type="button" class="btn blue small" data-a="paid" data-b="' + esc(b.id) + '" data-v="yes">' + esc(t('yes')) + '</button></div>') : '') + '</section>').join('') : empty(t('noWork'));
  }
  if (S.wtab === 'earn') {
    const total = S.data.work.reduce((a, b) => a + b.wage * b.days, 0);
    h += '<section class="card hero"><span class="muted small">' + esc(t('totalEarn')) + '</span><span class="big num">' + money(total) + '</span></section>' +
      '<section class="card"><div class="list">' + (S.data.work.length ? S.data.work.map(b => '<div class="li"><div class="grow"><b>' + esc(bSkill(b)) + '</b><div class="small muted">' + esc(b.site) + ' · ' + esc(b.days) + ' × ' + money(b.wage) + '</div></div><b class="num">' + money(b.wage * b.days) + '</b></div>').join('') : '<p class="muted" style="margin:0">' + esc(t('noWork')) + '</p>') + '</div></section>';
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
        '<button type="button" class="btn primary" data-a="startMem">' + esc(t('startMem')) + '</button></section>';
    }
  }
  if (S.wtab === 'profile') {
    h += renderWorkerProfile(true) + '<section class="card"><h2>' + esc(t('verifyTitle')) + '</h2><div class="list">' + v.map(x => '<div class="li"><div class="grow"><b>' + esc(t(x[0])) + '</b></div><span class="pill ' + (x[1] ? 'p-green' : 'p-amber') + '">' + esc(x[1] ? t('vDone') : t('vPending')) + '</span></div>').join('') + '</div></section>';
  }
  if (S.wtab === 'messages') h += renderMessages();
  return h + '</div>';
}

// ----- admin -----
const CFG = [
  ['worker_first_month', 'Worker – first month (UPI AutoPay)'], ['worker_monthly', 'Worker – monthly (UPI AutoPay)'], ['worker_cash_monthly', 'Worker – monthly (cash)'],
  ['contractor_plan', 'Contractor plan – monthly'], ['job_fee', 'Job fee – contractor without plan'], ['qc_per_day', 'Quality In-charge – per day'],
  ['margin_per_worker_day', 'Labour Katta margin – per worker per day'], ['silver_bonus', 'Silver tier bonus – per day'], ['gold_bonus', 'Gold tier bonus – per day']];
function renderAdmin() {
  const A = S.admin;
  let h = '<div class="stack"><h1>Admin</h1>' + tabs([['overview', 'Overview'], ['pricing', 'Plans & fees'], ['skills', 'Skills & rates'], ['workers', 'Workers'], ['contractors', 'Contractors'], ['bookings', 'Bookings'], ['payments', 'Payments'], ['outbox', 'WhatsApp outbox']], S.atab, 'atab');
  if (S.atab === 'overview' && A.overview) {
    const o = A.overview;
    h += '<div class="grid3">' + [['Workers', o.workers], ['Active members', o.activeMembers], ['Cash payments to collect', o.pendingCash], ['Contractors', o.contractors], ['Active contractor plans', o.activePlans], ['Bookings finding workers', o.openBookings], ['Real payments received', money(o.paidTotal)]]
      .map(x => '<section class="card"><span class="small muted">' + esc(x[0]) + '</span><span class="big num">' + esc(x[1]) + '</span></section>').join('') + '</div>' +
      '<section class="card"><h2>Integrations</h2><div class="list">' +
      [['Razorpay payments & UPI AutoPay', o.integrations.payments], ['WhatsApp Cloud API', o.integrations.whatsapp], ['Razorpay webhook secret', o.integrations.webhookSecret ? 'live' : 'test']]
        .map(x => '<div class="li"><div class="grow"><b>' + esc(x[0]) + '</b></div><span class="pill ' + (x[1] === 'live' ? 'p-green' : 'p-amber') + '">' + (x[1] === 'live' ? 'Connected' : 'Test mode') + '</span></div>').join('') +
      '</div><span class="small muted">Keys are set as environment variables on the server. See the README.</span></section>';
  }
  if (S.atab === 'pricing' && A.settings) {
    const d = S.cfgDraft || A.settings;
    h += '<section class="card"><h2>Plans & fees</h2><span class="small muted">All amounts in ₹. New prices apply to new bookings and new subscriptions.</span><div class="grid3">' +
      CFG.map(c => '<label class="f" for="cfg-' + c[0] + '">' + esc(c[1]) + '<input id="cfg-' + c[0] + '" class="in num" type="number" min="0" inputmode="numeric" data-cfg="' + c[0] + '" value="' + esc(d[c[0]]) + '"></label>').join('') + '</div>' +
      '<div class="row"><button type="button" class="btn blue" data-a="saveCfg">Save prices</button>' + (S.cfgDraft ? '<span class="pill p-amber">Unsaved changes</span>' : '') + '</div></section>';
  }
  if (S.atab === 'skills' && A.skills) {
    const margin = settings().margin_per_worker_day;
    h += '<section class="card"><h2>Skills & daily rates</h2><span class="small muted">' + A.skills.length + ' skills. Edit a field, then press Enter or move to the next field to save. Contractor price = wage + ' + money(margin) + ' margin.</span>' +
      '<div class="tablebox"><table><thead><tr><th>English</th><th>Hindi</th><th>Marathi</th><th>Type</th><th>Wage / day (₹)</th><th>Contractor price</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' +
      A.skills.map(s => '<tr><td><input class="in sm" style="min-width:160px" aria-label="English name" data-sk="' + esc(s.id) + '" data-fld="en" value="' + esc(s.en) + '"></td>' +
        '<td><input class="in sm" style="min-width:140px" aria-label="Hindi name for ' + esc(s.en) + '" data-sk="' + esc(s.id) + '" data-fld="hi" value="' + esc(s.hi) + '"></td>' +
        '<td><input class="in sm" style="min-width:140px" aria-label="Marathi name for ' + esc(s.en) + '" data-sk="' + esc(s.id) + '" data-fld="mr" value="' + esc(s.mr) + '"></td>' +
        '<td><select class="in sm" aria-label="Type for ' + esc(s.en) + '" data-sk="' + esc(s.id) + '" data-fld="cat"><option value="skilled"' + (s.cat === 'skilled' ? ' selected' : '') + '>Skilled</option><option value="unskilled"' + (s.cat === 'unskilled' ? ' selected' : '') + '>Unskilled</option></select></td>' +
        '<td><input class="in sm num" style="width:100px" type="number" min="1" aria-label="Wage for ' + esc(s.en) + '" data-sk="' + esc(s.id) + '" data-fld="wage" value="' + esc(s.wage) + '"></td>' +
        '<td class="num"><b>' + money(s.wage + margin) + '</b></td><td style="text-align:right;white-space:nowrap">' +
        (S.confirmDel === s.id ? '<button type="button" class="btn danger small" data-a="delSkill" data-v="' + esc(s.id) + '">Confirm remove</button> <button type="button" class="btn ghost small" data-a="noDel">Keep</button>' : '<button type="button" class="btn danger small" data-a="askDel" data-v="' + esc(s.id) + '">Remove</button>') + '</td></tr>').join('') +
      '</tbody></table></div><h3>Add a skill</h3><div class="grid3">' +
      '<label class="f" for="ns-en">English name<input id="ns-en" class="in" data-f="newEn" value="' + esc(S.f.newEn) + '" placeholder="e.g. Scaffolding fitter"></label>' +
      '<label class="f" for="ns-hi">Hindi name<input id="ns-hi" class="in" data-f="newHi" value="' + esc(S.f.newHi) + '"></label>' +
      '<label class="f" for="ns-mr">Marathi name<input id="ns-mr" class="in" data-f="newMr" value="' + esc(S.f.newMr) + '"></label>' +
      '<label class="f" for="ns-cat">Type<select id="ns-cat" class="in" data-f="newCat"><option value="skilled"' + (S.f.newCat === 'skilled' ? ' selected' : '') + '>Skilled</option><option value="unskilled"' + (S.f.newCat === 'unskilled' ? ' selected' : '') + '>Unskilled</option></select></label>' +
      '<label class="f" for="ns-wage">Wage / day (₹)<input id="ns-wage" class="in num" type="number" min="1" data-f="newWage" value="' + esc(S.f.newWage) + '" placeholder="900"></label>' +
      '<div class="f" style="justify-content:flex-end"><button type="button" class="btn primary" data-a="addSkill">Add skill</button></div></div>' + errBox() + '</section>';
  }
  if (S.atab === 'workers' && A.workers) {
    const sk = A.skills || [];
    h += '<section class="card"><h2>Workers & individual rates</h2><span class="small muted">Tick verifications after checking documents. Leave custom wage empty to use skill rate + tier bonus.</span><div class="tablebox"><table><thead><tr><th>Worker</th><th>Skills</th><th>Aadhaar</th><th>Photo</th><th>Bank</th><th>Skill test</th><th>Membership</th><th>Free trial</th><th>Special price (₹/month)</th><th>Tier</th><th>Custom wage (₹)</th><th>Portal</th></tr></thead><tbody>' +
      (A.workers.length ? A.workers.map(w => '<tr><td><b>' + esc(w.name) + '</b><div class="small muted num">' + esc(w.phone) + (w.area ? ' · ' + esc(w.area) : '') + (w.upi_id ? ' · ' + esc(w.upi_id) : '') + '</div></td>' +
        '<td class="small">' + esc(w.skills.map(id => (sk.find(s => s.id === id) || {}).en || '—').join(', ')) + '</td>' +
        ['verified_aadhaar', 'verified_photo', 'verified_bank', 'verified_test'].map(k => '<td><input type="checkbox" style="width:22px;height:22px" aria-label="' + k.replace('verified_', '') + ' verified for ' + esc(w.name) + '" data-wk="' + esc(w.user_id) + '" data-fld="' + k + '"' + (w[k] ? ' checked' : '') + '></td>').join('') +
        '<td>' + (w.membership_status === 'active' ? '<span class="pill p-green">Active · ' + (w.membership_method === 'cash' ? 'Cash' : 'AutoPay') + '</span>'
          : w.membership_status === 'trial' ? '<span class="pill p-blue">Trial to ' + esc(fmtDate(w.trial_until)) + '</span>'
          : w.membership_status === 'pending_cash' ? '<button type="button" class="btn primary small" data-a="cashReceived" data-v="' + esc(w.user_id) + '">Cash received</button>' : '<span class="pill p-grey">Not paid</span>') + '</td>' +
        '<td style="white-space:nowrap">' + (w.membership_status === 'active' ? '—' : '<input id="trial-' + esc(w.user_id) + '" class="in sm num" style="width:64px" type="number" min="1" max="365" value="30" aria-label="Trial days for ' + esc(w.name) + '"> <button type="button" class="btn ghost small" data-a="trialW" data-v="' + esc(w.user_id) + '">Give days</button>') + '</td>' +
        '<td><input class="in sm num" style="width:100px" type="number" min="1" placeholder="Standard" aria-label="Special price for ' + esc(w.name) + '" data-wp="' + esc(w.user_id) + '" value="' + esc(w.custom_price == null ? '' : w.custom_price) + '"></td>' +
        '<td><select class="in sm" aria-label="Tier for ' + esc(w.name) + '" data-wk="' + esc(w.user_id) + '" data-fld="tier">' + ['bronze', 'silver', 'gold'].map(x => '<option value="' + x + '"' + (w.tier === x ? ' selected' : '') + '>' + x[0].toUpperCase() + x.slice(1) + '</option>').join('') + '</select></td>' +
        '<td><input class="in sm num" style="width:100px" type="number" min="1" placeholder="—" aria-label="Custom wage for ' + esc(w.name) + '" data-wk="' + esc(w.user_id) + '" data-fld="custom_wage" value="' + esc(w.custom_wage == null ? '' : w.custom_wage) + '"></td>' +
        '<td><button type="button" class="btn blue small" data-a="actAs" data-v="' + esc(w.user_id) + '">Open</button></td></tr>').join('')
        : '<tr><td colspan="12" class="muted">No workers yet.</td></tr>') + '</tbody></table></div></section>';
  }
  if (S.atab === 'contractors' && A.contractors) {
    h += '<section class="card"><h2>Contractors</h2><span class="small muted">Contractors must pay the monthly plan before they can book or get messages. Give a free trial or a special price here.</span><div class="tablebox"><table><thead><tr><th>Company</th><th>Phone</th><th>Plan</th><th>Free trial</th><th>Special price (₹/month)</th><th>Joined</th><th>Portal</th></tr></thead><tbody>' +
      (A.contractors.length ? A.contractors.map(c => '<tr><td><b>' + esc(c.company) + '</b><div class="small muted">' + esc(c.gst || '') + '</div></td><td class="num">' + esc(c.phone) + '</td>' +
        '<td>' + (c.plan_status === 'active' ? '<span class="pill p-green">Paid</span>' : c.plan_status === 'trial' ? '<span class="pill p-blue">Trial to ' + esc(fmtDate(c.trial_until)) + '</span>' : '<span class="pill p-grey">Not paid</span>') + '</td>' +
        '<td style="white-space:nowrap">' + (c.plan_status === 'active' ? '—' : '<input id="trial-' + esc(c.user_id) + '" class="in sm num" style="width:64px" type="number" min="1" max="365" value="30" aria-label="Trial days for ' + esc(c.company) + '"> <button type="button" class="btn ghost small" data-a="trialC" data-v="' + esc(c.user_id) + '">Give days</button>') + '</td>' +
        '<td><input class="in sm num" style="width:100px" type="number" min="1" placeholder="Standard" aria-label="Special price for ' + esc(c.company) + '" data-cp="' + esc(c.user_id) + '" value="' + esc(c.custom_price == null ? '' : c.custom_price) + '"></td>' +
        '<td class="num">' + esc(fmtDate(c.created_at)) + '</td><td><button type="button" class="btn blue small" data-a="actAs" data-v="' + esc(c.user_id) + '">Open</button></td></tr>').join('') : '<tr><td colspan="7" class="muted">No contractors yet.</td></tr>') + '</tbody></table></div></section>';
  }
  if (S.atab === 'bookings' && A.bookings) {
    h += '<section class="card"><h2>Bookings</h2><div class="tablebox"><table><thead><tr><th>Contractor</th><th>Work</th><th>Site</th><th>Start</th><th>Assigned</th><th>Payment</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
      (A.bookings.length ? A.bookings.map(b => '<tr><td>' + esc(b.company) + '</td><td>' + esc(b.count) + ' × ' + esc(b.skill_en) + '</td><td>' + esc(b.site) + '</td><td class="num">' + esc(fmtDate(b.start_date)) + '</td><td class="num">' + b.assigned + ' / ' + b.count + '</td><td>' + (b.pay_mode === 'lk' ? 'Via Labour Katta' : 'Direct') + ' · ' + esc(b.payment_status) + '</td><td class="num">' + money(b.amount_due) + '</td><td>' + statusPill(b) + '</td></tr>').join('') : '<tr><td colspan="8" class="muted">No bookings yet.</td></tr>') + '</tbody></table></div></section>';
  }
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
  else html = S.me.worker ? renderWorker() : '<div class="login stack">' + renderWorkerProfile(false) + '</div>';
  app.innerHTML = '<div style="padding-top:16px">' + html + '</div>';
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (ss != null && el.setSelectionRange) el.setSelectionRange(ss, se); } catch (e) { /* not a text field */ } } }
}

function fillWorkerForm() {
  const w = S.me && S.me.worker; if (!w) return;
  Object.assign(S.f, { wname: w.name, warea: w.area, wexp: w.experience || '1-3', wupi: w.upi_id });
  S.f.wskills = {}; w.skills.forEach(id => { S.f.wskills[id] = true; });
}

// ---------- events ----------
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-a]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const a = b.getAttribute('data-a'), v = b.getAttribute('data-v'), bid = b.getAttribute('data-b');
  if (modalHandlers[a]) { modalHandlers[a](); return; }
  S.err = '';
  const simple = {
    lang: () => { S.lang = v; store('lang', v); if (S.me && S.me.user) api('POST', '/api/me/lang', { lang: v }).catch(() => {}); },
    view: () => { S.view = v; store('view', v); loadTab().then(render); },
    set: () => { const k = b.getAttribute('data-k'); S.f[k] = k === 'days' ? n0(v) : v; },
    toggle: () => { const k = b.getAttribute('data-k'); S.f[k] = !S.f[k]; },
    count: () => { S.f.count = Math.max(1, Math.min(100, S.f.count + (v === '-1' ? -1 : 1))); },
    wskill: () => { S.f.wskills[v] = !S.f.wskills[v]; },
    portal: () => { S.portal = v; store('portal', v); S.login = { phone: '', code: '', sent: false, devCode: '' }; },
    changeNumber: () => { S.login = { phone: S.login.phone, code: '', sent: false, devCode: '' }; },
    askCancel: () => { S.confirmCancel = bid; }, noCancel: () => { S.confirmCancel = ''; },
    askDel: () => { S.confirmDel = v; }, noDel: () => { S.confirmDel = ''; },
    toggleCfg: () => { const k = b.getAttribute('data-k'); S.cfgDraft = Object.assign({}, S.cfgDraft || S.admin.settings); S.cfgDraft[k] = S.cfgDraft[k] ? 0 : 1; },
  };
  if (simple[a]) { simple[a](); render(); return; }
  const tabsAct = { ctab: 'ctab', wtab: 'wtab', atab: 'atab' };
  if (tabsAct[a]) { S[a] = v; S.confirmDel = ''; S.cfgDraft = null; if (a === 'wtab' && v === 'profile') fillWorkerForm(); render(); loadTab().then(render); return; }

  const actions = {
    sendOtp: async () => { const r = await api('POST', '/api/auth/request-otp', { phone: S.login.phone, lang: S.lang }); S.login.sent = true; S.login.devCode = r.devCode || ''; },
    verifyOtp: async () => { await api('POST', '/api/auth/verify-otp', { phone: S.login.phone, code: S.login.code, lang: S.lang, portal: S.portal }); S.login = { phone: '', code: '', sent: false, devCode: '' }; await refresh(); },
    adminLogin: async () => { await api('POST', '/api/auth/admin-login', { username: S.adm.user, password: S.adm.pass }); S.adm = { open: false, user: '', pass: '' }; S.view = 'admin'; store('view', 'admin'); await refresh(); },
    actAs: async () => { await api('POST', '/api/admin/act-as', { userId: v }); S.view = 'app'; store('view', 'app'); S.ctab = 'home'; S.wtab = 'jobs'; await refresh(); },
    stopActing: async () => { await api('POST', '/api/auth/stop-acting'); S.view = 'admin'; store('view', 'admin'); await refresh(); },
    trialC: async () => { const d = n0((document.getElementById('trial-' + v) || {}).value); await api('POST', '/api/admin/contractors/' + v + '/trial', { days: d }); toast('Free trial given'); await loadTab(); },
    trialW: async () => { const d = n0((document.getElementById('trial-' + v) || {}).value); await api('POST', '/api/admin/workers/' + v + '/trial', { days: d }); toast('Free trial given'); await loadTab(); },
    logout: async () => { await api('POST', '/api/auth/logout'); S.view = 'app'; store('view', 'app'); S.portal = ''; store('portal', ''); await loadMe(); },
    chooseRole: async () => { await api('POST', '/api/me/role', { role: v }); await loadMe(); },
    saveContractor: async () => { await api('POST', '/api/contractor/profile', { company: S.f.company, gst: S.f.gst }); await refresh(); },
    saveWorker: async () => { await api('POST', '/api/worker/profile', { name: S.f.wname, area: S.f.warea, experience: S.f.wexp, upiId: S.f.wupi, skills: Object.keys(S.f.wskills).filter(k => S.f.wskills[k]) }); toast(t('saved')); await refresh(); },
    book: async () => {
      const f = S.f;
      const r = await api('POST', '/api/contractor/bookings', { skillId: f.skillId, count: f.count, days: f.days, level: f.level, qc: f.qc, payMode: f.pay, site: f.site, startDate: f.start });
      if (r.payment) { const ok = await pay(r.payment, t('tBook')); if (!ok) { S.ctab = 'bookings'; await refresh(); return; } }
      toast(t('bookingSent')); S.f.site = ''; S.ctab = 'bookings'; await refresh();
    },
    payBooking: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/pay'); if (await pay(r.payment, t('tBook'))) toast(t('bookingSent')); await refresh(); },
    att: async () => { await api('POST', '/api/contractor/bookings/' + bid + '/attendance', { workerId: b.getAttribute('data-w'), status: v }); await loadTab(); },
    replace: async () => { await api('POST', '/api/contractor/bookings/' + bid + '/replace', { workerId: b.getAttribute('data-w') }); toast(t('replaceAsked')); await loadTab(); },
    cancelBooking: async () => { const r = await api('POST', '/api/contractor/bookings/' + bid + '/cancel'); S.confirmCancel = ''; if (r.refundNeeded) toast(t('refundNote')); await loadTab(); },
    startPlan: async () => { const r = await api('POST', '/api/contractor/plan'); await pay(r.payment, t('planTitle')); await refresh(); },
    cancelPlan: async () => { await api('POST', '/api/contractor/plan/cancel'); await refresh(); },
    accept: async () => { await api('POST', '/api/worker/jobs/' + bid + '/accept'); toast(t('accepted')); S.wtab = 'work'; await loadTab(); },
    paid: async () => { await api('POST', '/api/worker/work/' + bid + '/paid', { received: v === 'yes' }); await loadTab(); },
    startMem: async () => { const r = await api('POST', '/api/worker/membership', { method: S.f.memMethod }); if (r.payment) await pay(r.payment, t('memTitle')); await refresh(); },
    cancelMem: async () => { await api('POST', '/api/worker/membership/cancel'); await refresh(); },
    saveCfg: async () => { const r = await api('PUT', '/api/admin/settings', S.cfgDraft || S.admin.settings); S.admin.settings = r.settings; S.cfgDraft = null; toast('Prices saved'); await loadMe(); },
    addSkill: async () => { await api('POST', '/api/admin/skills', { en: S.f.newEn, hi: S.f.newHi, mr: S.f.newMr, cat: S.f.newCat, wage: n0(S.f.newWage) }); Object.assign(S.f, { newEn: '', newHi: '', newMr: '', newWage: '' }); toast('Skill added'); await refresh(); },
    delSkill: async () => { await api('DELETE', '/api/admin/skills/' + v); S.confirmDel = ''; toast('Skill removed'); await refresh(); },
    cashReceived: async () => { await api('POST', '/api/admin/workers/' + v + '/cash-received'); toast('Membership activated'); await loadTab(); },
  };
  if (actions[a]) act(actions[a]);
});
document.addEventListener('input', (ev) => {
  const el = ev.target;
  const lf = el.getAttribute('data-lf'); if (lf) { S.login[lf] = el.value; return; }
  const af = el.getAttribute('data-af'); if (af) { S.adm[af] = el.value; return; }
  const k = el.getAttribute('data-f'); if (k) { S.f[k] = el.value; return; }
  const c = el.getAttribute('data-cfg'); if (c) { S.cfgDraft = Object.assign({}, S.cfgDraft || S.admin.settings); S.cfgDraft[c] = n0(el.value); }
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  const k = el.getAttribute('data-f'); if (k) { S.f[k] = el.value; if (k === 'start') render(); return; }
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
  if (ev.target.matches('[data-sk],[data-wk],[data-cp],[data-wp]')) ev.target.blur();
  if (ev.target.id === 'l-phone') document.querySelector('[data-a="sendOtp"]').click();
  if (ev.target.id === 'a-pass') document.querySelector('[data-a="adminLogin"]').click();
  if (ev.target.id === 'l-code') document.querySelector('[data-a="verifyOtp"]').click();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && (S.me.user || S.me.adminSession)) refresh(); });
setInterval(() => { if (!document.hidden && S.me && (S.me.user || S.me.adminSession) && !S.busy && !document.querySelector('.modal') && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) loadTab().then(render); }, 30000);

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
refresh().catch(e => { document.getElementById('app').innerHTML = '<div class="empty" style="margin-top:24px"><p style="margin:0">' + esc(e.message) + '</p></div>'; });
})();
