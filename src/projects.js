'use strict';
// Projects marketplace: builders, architects, developers and owners ("clients") post requirements; contractors,
// professionals and suppliers ("partners") quote; the client awards one quote and pays the inspection (quality) charge
// plus the platform fee for that transaction; Labour Katta assigns an inspector who records the result.
const { db, getSettings } = require('./db');
const { id, nowIso, todayIST, formatDate, rupees, HttpError, bad } = require('./util');
const wa = require('./services/whatsapp');
const quality = require('./quality');

const BIZ_TYPES = ['builder', 'architect', 'developer', 'owner', 'contractor_firm'];
const TERMS_ERR = () => bad('Please tick that you agree to the terms first.', 'terms_required');

const getPartner = (uid) => db.prepare('SELECT p.*, u.phone, u.lang, u.deleted_at FROM partners p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?').get(uid);
const partnerCategoryIds = (uid) => db.prepare('SELECT category_id FROM partner_categories WHERE partner_id = ?').all(uid).map(r => r.category_id);
const partnerVerified = (p) => Boolean(p && p.verified_docs && (p.verified_licence || p.verified_site));
const pFlags = (p) => ({ phone: 1, docs: p.verified_docs ? 1 : 0, licence: p.verified_licence ? 1 : 0, site: p.verified_site ? 1 : 0, verified: partnerVerified(p) ? 1 : 0 });
const getCategory = (cid) => db.prepare('SELECT c.*, g.en AS group_en, g.hi AS group_hi, g.mr AS group_mr FROM svc_categories c JOIN svc_groups g ON g.id = c.group_id WHERE c.id = ?').get(cid);
const catLabel = (c, lang) => c ? ((lang === 'hi' && c.hi) || (lang === 'mr' && c.mr) || c.en) : '';

function partnerStats(uid) {
  const r = db.prepare("SELECT AVG(stars) AS avg, COUNT(*) AS n FROM project_ratings WHERE partner_id = ? AND dispute_status != 'removed'").get(uid);
  const done = db.prepare("SELECT COUNT(*) AS n FROM projects p JOIN quotes q ON q.id = p.awarded_quote_id WHERE q.partner_id = ? AND p.status = 'completed'").get(uid).n;
  const won = db.prepare("SELECT COUNT(*) AS n FROM projects p JOIN quotes q ON q.id = p.awarded_quote_id WHERE q.partner_id = ? AND p.status IN ('awarded','completed')").get(uid).n;
  return { rating: { avg: r.n ? Math.round(r.avg * 10) / 10 : null, count: r.n }, completed: done, won };
}
/** What clients see about a partner before the award: no phone number. */
function partnerCard(p, viewerId) {
  const cats = db.prepare('SELECT c.id, c.en, c.hi, c.mr FROM partner_categories pc JOIN svc_categories c ON c.id = pc.category_id WHERE pc.partner_id = ? AND c.active = 1 ORDER BY c.sort').all(p.user_id);
  return { partner_id: p.user_id, company: p.company, contact_name: p.contact_name, city: p.city, areas: p.areas, experience_years: p.experience_years, team_size: p.team_size,
    about: p.about, categories: cats, v: pFlags(p), stats: partnerStats(p.user_id),
    favourite: viewerId ? Boolean(db.prepare('SELECT 1 FROM favourites WHERE contractor_id = ? AND worker_id = ?').get(viewerId, p.user_id)) : false };
}

function savePartnerProfile(uid, body) {
  const s = (v, name, max, req) => { const x = String(v == null ? '' : v).trim(); if (req && !x) throw bad(`Enter ${name}.`); if (x.length > max) throw bad(`${name} is too long.`); return x; };
  const company = s(body.company, 'your company or full name', 120, true);
  const city = s(body.city, 'your city', 80, true);
  const cats = Array.isArray(body.categories) ? [...new Set(body.categories.map(String))] : [];
  const valid = cats.length ? db.prepare(`SELECT id FROM svc_categories WHERE active = 1 AND id IN (${cats.map(() => '?').join(',')})`).all(...cats).map(r => r.id) : [];
  if (!valid.length) throw bad('Choose at least one type of work or service you provide.', 'no_categories');
  if (valid.length > 25) throw bad('Choose at most 25 categories.');
  const num = (v, max) => { const n = Number(v || 0); return Number.isInteger(n) && n >= 0 && n <= max ? n : 0; };
  const row = { user_id: uid, company, contact_name: s(body.contactName, 'contact name', 80), city, areas: s(body.areas, 'areas', 200),
    experience_years: num(body.experienceYears, 80), team_size: num(body.teamSize, 100000), gst: s(body.gst, 'GST number', 20).toUpperCase(),
    licence_no: s(body.licenceNo, 'licence / registration number', 60), about: s(body.about, 'about your work', 1000), created_at: nowIso() };
  db.transaction(() => {
    db.prepare(`INSERT INTO partners (user_id, company, contact_name, city, areas, experience_years, team_size, gst, licence_no, about, created_at)
      VALUES (@user_id, @company, @contact_name, @city, @areas, @experience_years, @team_size, @gst, @licence_no, @about, @created_at)
      ON CONFLICT(user_id) DO UPDATE SET company = excluded.company, contact_name = excluded.contact_name, city = excluded.city, areas = excluded.areas,
        experience_years = excluded.experience_years, team_size = excluded.team_size, gst = excluded.gst, licence_no = excluded.licence_no, about = excluded.about`).run(row);
    db.prepare('DELETE FROM partner_categories WHERE partner_id = ?').run(uid);
    const ins = db.prepare('INSERT INTO partner_categories (partner_id, category_id) VALUES (?, ?)');
    valid.forEach(c => ins.run(uid, c));
  })();
  return getPartner(uid);
}

// Partners who should hear about a project: active, in that category, not blocked, verified if the admin requires it.
function matchingPartners(project) {
  const onlyVerified = getSettings().partner_leads_verified_only;
  return db.prepare(`SELECT p.*, u.phone, u.lang FROM partners p JOIN users u ON u.id = p.user_id JOIN partner_categories pc ON pc.partner_id = p.user_id
    WHERE pc.category_id = ? AND u.deleted_at IS NULL AND p.status = 'active'`).all(project.category_id)
    .filter(p => (!onlyVerified || partnerVerified(p)) && !quality.blocked(p.user_id, project.client_id));
}
async function notifyLead(project, partners) {
  const c = getCategory(project.category_id);
  const budget = project.budget_max ? (project.budget_min ? rupees(project.budget_min) + '–' : 'up to ') + rupees(project.budget_max) : 'not given';
  for (const p of partners.slice(0, 200)) {
    await wa.sendTemplate({ userId: p.user_id, phone: p.phone, lang: p.lang, templateKey: 'newLead', params: { category: catLabel(c, p.lang), title: project.title, city: project.city || '-', budget } });
  }
}

function validateProject(body) {
  const cat = getCategory(String(body.categoryId || ''));
  if (!cat || !cat.active) throw bad('Choose the type of contractor or professional you need.', 'bad_category');
  const title = String(body.title || '').trim();
  if (title.length < 5 || title.length > 120) throw bad('Write a short title (5 to 120 characters).');
  const description = String(body.description || '').trim();
  if (description.length > 3000) throw bad('Description is too long.');
  const city = String(body.city || '').trim().slice(0, 80);
  if (!city) throw bad('Enter the city.');
  const site_address = String(body.siteAddress || '').trim().slice(0, 300);
  let lat = body.siteLat == null || body.siteLat === '' ? null : Number(body.siteLat), lng = body.siteLng == null || body.siteLng === '' ? null : Number(body.siteLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { lat = null; lng = null; }
  const money = (v) => v == null || v === '' ? null : Number(v);
  const bmin = money(body.budgetMin), bmax = money(body.budgetMax);
  for (const v of [bmin, bmax]) if (v != null && (!Number.isInteger(v) || v < 0 || v > 1e10)) throw bad('Budget must be a whole number of rupees.');
  if (bmin != null && bmax != null && bmin > bmax) throw bad('Minimum budget is more than maximum.');
  const start = body.startDate ? String(body.startDate) : null;
  if (start && (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < todayIST())) throw bad('Choose a start date from today onwards.');
  const dur = body.durationDays == null || body.durationDays === '' ? null : Number(body.durationDays);
  if (dur != null && (!Number.isInteger(dur) || dur < 1 || dur > 2000)) throw bad('Duration must be between 1 and 2000 days.');
  if (!body.acceptTerms) throw TERMS_ERR();
  return { category_id: cat.id, title, description, city, site_address, site_lat: lat, site_lng: lng, budget_min: bmin, budget_max: bmax, start_date: start, duration_days: dur };
}

async function createProject(clientId, body) {
  const input = validateProject(body);
  const invite = Array.isArray(body.invite) ? [...new Set(body.invite.map(String))].slice(0, 50) : [];
  const row = Object.assign({ id: id('prj'), client_id: clientId, invited_only: body.invitedOnly && invite.length ? 1 : 0, terms_accepted_at: nowIso(), created_at: nowIso() }, input);
  db.prepare(`INSERT INTO projects (id, client_id, category_id, title, description, city, site_address, site_lat, site_lng, budget_min, budget_max, start_date, duration_days, invited_only, terms_accepted_at, created_at)
    VALUES (@id, @client_id, @category_id, @title, @description, @city, @site_address, @site_lat, @site_lng, @budget_min, @budget_max, @start_date, @duration_days, @invited_only, @terms_accepted_at, @created_at)`).run(row);
  db.prepare('UPDATE users SET terms_accepted_at = COALESCE(terms_accepted_at, ?) WHERE id = ?').run(nowIso(), clientId);
  const invited = inviteToProject(row, invite);
  const audience = row.invited_only ? invited : matchingPartners(row);
  await notifyLead(row, audience);
  return { id: row.id, notified: audience.length };
}
function inviteToProject(project, partnerIds) {
  const out = [];
  for (const pid of partnerIds) {
    const p = getPartner(pid);
    if (!p || p.deleted_at || quality.blocked(pid, project.client_id)) continue;
    db.prepare('INSERT OR IGNORE INTO project_invites (project_id, partner_id, created_at) VALUES (?, ?, ?)').run(project.id, pid, nowIso());
    out.push(p);
  }
  return out;
}

/** Open projects a partner can quote on. */
function leadsFor(partnerId) {
  const cats = partnerCategoryIds(partnerId);
  const rows = db.prepare(`SELECT p.*, c.company AS client_company, c.biz_type FROM projects p JOIN contractors c ON c.user_id = p.client_id
    WHERE p.status = 'open' ORDER BY p.created_at DESC LIMIT 300`).all();
  const invited = new Set(db.prepare('SELECT project_id FROM project_invites WHERE partner_id = ?').all(partnerId).map(r => r.project_id));
  return rows.filter(p => (invited.has(p.id) || (!p.invited_only && cats.includes(p.category_id))) && !quality.blocked(partnerId, p.client_id))
    .map(p => Object.assign(publicProject(p), { invited: invited.has(p.id), myQuote: db.prepare('SELECT id, amount, days, note, status FROM quotes WHERE project_id = ? AND partner_id = ?').get(p.id, partnerId) || null,
      quotes: db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE project_id = ? AND status = 'submitted'").get(p.id).n }));
}
function publicProject(p) {
  const c = getCategory(p.category_id);
  return { id: p.id, title: p.title, description: p.description, city: p.city, site_address: p.site_address, site_lat: p.site_lat, site_lng: p.site_lng,
    budget_min: p.budget_min, budget_max: p.budget_max, start_date: p.start_date, duration_days: p.duration_days, status: p.status, created_at: p.created_at,
    category: c ? { id: c.id, en: c.en, hi: c.hi, mr: c.mr, group_en: c.group_en, group_hi: c.group_hi, group_mr: c.group_mr } : null,
    client_company: p.client_company, biz_type: p.biz_type, client_id: p.client_id };
}

async function submitQuote(partnerId, projectId, body) {
  const partner = getPartner(partnerId);
  if (!partner) throw new HttpError(403, 'Create your profile first.', 'no_profile');
  if (!body.acceptTerms) throw TERMS_ERR();
  const lead = leadsFor(partnerId).find(p => p.id === projectId);
  if (!lead) throw new HttpError(409, 'This project is no longer open to you.', 'not_available');
  const amount = Number(body.amount), days = Number(body.days);
  if (!Number.isInteger(amount) || amount < 1 || amount > 1e10) throw bad('Enter your price in rupees.', 'bad_amount');
  if (!Number.isInteger(days) || days < 1 || days > 2000) throw bad('Enter how many days the work will take.', 'bad_days');
  const note = String(body.note || '').trim().slice(0, 1000);
  const old = db.prepare('SELECT * FROM quotes WHERE project_id = ? AND partner_id = ?').get(projectId, partnerId);
  if (old && old.status !== 'submitted' && old.status !== 'withdrawn') throw bad('This quote can no longer be changed.', 'quote_locked');
  db.prepare(`INSERT INTO quotes (id, project_id, partner_id, amount, days, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
    ON CONFLICT(project_id, partner_id) DO UPDATE SET amount = excluded.amount, days = excluded.days, note = excluded.note, status = 'submitted', updated_at = excluded.updated_at`)
    .run(old ? old.id : id('qt'), projectId, partnerId, amount, days, note, nowIso(), nowIso());
  db.prepare('UPDATE users SET terms_accepted_at = COALESCE(terms_accepted_at, ?) WHERE id = ?').run(nowIso(), partnerId);
  if (!old) {
    const client = db.prepare('SELECT c.*, u.phone, u.lang FROM contractors c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?').get(lead.client_id);
    if (client) await wa.sendTemplate({ userId: client.user_id, phone: client.phone, lang: client.lang, templateKey: 'quoteReceived', params: { company: partner.company, title: lead.title, amount: rupees(amount) } });
  }
  return { ok: true };
}

const fees = () => { const s = getSettings(); return { inspection: s.project_inspection_fee || 0, platform: s.project_platform_fee || 0 }; };

/** Client picks a quote. The inspection charge + platform fee are paid before the award is confirmed. */
function startAward(clientId, projectId, quoteId) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND client_id = ?').get(projectId, clientId);
  if (!p) throw new HttpError(404, 'Project not found.', 'not_found');
  if (p.status !== 'open') throw bad('This project is not open any more.', 'not_open');
  const q = db.prepare("SELECT * FROM quotes WHERE id = ? AND project_id = ? AND status = 'submitted'").get(String(quoteId || ''), p.id);
  if (!q) throw new HttpError(404, 'Quote not found.', 'not_found');
  const f = fees();
  db.prepare("UPDATE projects SET awarded_quote_id = ?, inspection_fee = ?, platform_fee = ?, payment_status = 'pending' WHERE id = ?").run(q.id, f.inspection, f.platform, p.id);
  return { amount: f.inspection + f.platform, fees: f };
}
/** Payment received (or nothing to pay): confirm the award, close other quotes, tell the partner with the client's number. */
async function projectPaid(projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!p || p.status !== 'open' || !p.awarded_quote_id) return;
  db.transaction(() => {
    db.prepare("UPDATE projects SET status = 'awarded', payment_status = 'paid', awarded_at = ? WHERE id = ?").run(nowIso(), p.id);
    db.prepare("UPDATE quotes SET status = 'accepted', updated_at = ? WHERE id = ?").run(nowIso(), p.awarded_quote_id);
    db.prepare("UPDATE quotes SET status = 'rejected', updated_at = ? WHERE project_id = ? AND id != ? AND status = 'submitted'").run(nowIso(), p.id, p.awarded_quote_id);
  })();
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(p.awarded_quote_id);
  const partner = getPartner(q.partner_id);
  const client = db.prepare('SELECT c.*, u.phone FROM contractors c JOIN users u ON u.id = c.user_id WHERE c.user_id = ?').get(p.client_id);
  if (partner) await wa.sendTemplate({ userId: partner.user_id, phone: partner.phone, lang: partner.lang, templateKey: 'projectAwarded',
    params: { title: p.title, client: client ? client.company : 'Client', phone: client ? client.phone : '' } });
}

async function setInspection(projectId, status, notes) {
  if (!['scheduled', 'passed', 'issues'].includes(status)) throw bad('Choose scheduled, passed or issues found.');
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!p || !['awarded', 'completed'].includes(p.status)) throw new HttpError(404, 'Project not found or not awarded yet.', 'not_found');
  const n = String(notes || '').trim().slice(0, 1000);
  if (status !== 'scheduled' && n.length < 3) throw bad('Write what the inspector found.');
  db.prepare('UPDATE projects SET inspection_status = ?, inspection_notes = ?, inspection_at = ? WHERE id = ?').run(status, n, nowIso(), p.id);
  if (status === 'scheduled') return;
  const q = db.prepare('SELECT partner_id FROM quotes WHERE id = ?').get(p.awarded_quote_id);
  const people = [db.prepare('SELECT id AS user_id, phone, lang FROM users WHERE id = ?').get(p.client_id), q && db.prepare('SELECT id AS user_id, phone, lang FROM users WHERE id = ?').get(q.partner_id)].filter(Boolean);
  for (const u of people) await wa.sendTemplate({ userId: u.user_id, phone: u.phone, lang: u.lang, templateKey: 'inspectionResult',
    params: { title: p.title, result: status === 'passed' ? 'Passed' : 'Issues found', notes: n.slice(0, 300) } });
}

module.exports = { BIZ_TYPES, getPartner, partnerCategoryIds, partnerVerified, pFlags, partnerStats, partnerCard, savePartnerProfile, getCategory, catLabel,
  createProject, inviteToProject, notifyLead, leadsFor, publicProject, submitQuote, startAward, projectPaid, setInspection, fees, matchingPartners };
