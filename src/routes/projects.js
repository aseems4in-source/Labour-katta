'use strict';
// Projects marketplace routes for clients (builder accounts) and partners (contractors / professionals / suppliers).
const { db } = require('../db');
const { nowIso, HttpError, bad, str } = require('../util');
const auth = require('../auth');
const P = require('../projects');
const reports = require('../reports');

const r = require('../router')();

// Categories (public: shown on the sign-up form).
r.get('/categories', (req, res) => {
  const groups = db.prepare('SELECT * FROM svc_groups ORDER BY sort').all();
  const cats = db.prepare('SELECT id, group_id, en, hi, mr FROM svc_categories WHERE active = 1 ORDER BY sort').all();
  res.json({ groups: groups.map(g => Object.assign(g, { categories: cats.filter(c => c.group_id === g.id) })) });
});

// ================= partner (contractor / professional / supplier) =================
const isPartner = auth.requireRole('partner');
function needProfile(req) { const p = P.getPartner(req.user.id); if (!p) throw new HttpError(403, 'Create your profile first.', 'no_profile'); return p; }

r.post('/partner/profile', isPartner, (req, res) => {
  P.savePartnerProfile(req.user.id, req.body || {});
  res.json({ ok: true });
});
r.get('/partner/leads', isPartner, (req, res) => { needProfile(req); res.json({ leads: P.leadsFor(req.user.id) }); });
r.post('/partner/projects/:id/quote', isPartner, async (req, res) => { res.json(await P.submitQuote(req.user.id, req.params.id, req.body || {})); });
r.post('/partner/quotes/:id/withdraw', isPartner, (req, res) => {
  const q = db.prepare("SELECT q.* FROM quotes q JOIN projects p ON p.id = q.project_id WHERE q.id = ? AND q.partner_id = ? AND q.status = 'submitted' AND p.status = 'open'").get(req.params.id, req.user.id);
  if (!q) throw new HttpError(404, 'Quote not found.', 'not_found');
  db.prepare("UPDATE quotes SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(nowIso(), q.id);
  res.json({ ok: true });
});
// Work won: client contact shown only after the award is paid.
r.get('/partner/work', isPartner, (req, res) => {
  const rows = db.prepare(`SELECT p.*, q.amount AS quote_amount, q.days AS quote_days, q.status AS quote_status, c.company AS client_company, c.biz_type, u.phone AS client_phone
    FROM quotes q JOIN projects p ON p.id = q.project_id JOIN contractors c ON c.user_id = p.client_id JOIN users u ON u.id = p.client_id
    WHERE q.partner_id = ? AND q.status IN ('accepted','rejected','submitted','withdrawn') ORDER BY q.updated_at DESC LIMIT 200`).all(req.user.id);
  res.json({ work: rows.map(p => Object.assign(P.publicProject(p), {
    quote: { amount: p.quote_amount, days: p.quote_days, status: p.quote_status },
    client_phone: p.quote_status === 'accepted' && p.payment_status === 'paid' ? p.client_phone : null,
    inspection_status: p.quote_status === 'accepted' ? p.inspection_status : null, inspection_notes: p.quote_status === 'accepted' ? p.inspection_notes : '',
    rating: p.quote_status === 'accepted' ? db.prepare('SELECT stars, comment, dispute_status FROM project_ratings WHERE project_id = ?').get(p.id) || null : null,
  })) });
});
r.post('/partner/ratings/:id/dispute', isPartner, async (req, res) => {
  const rt = db.prepare('SELECT * FROM project_ratings WHERE project_id = ? AND partner_id = ?').get(req.params.id, req.user.id);
  if (!rt) throw new HttpError(404, 'Rating not found.', 'not_found');
  if (rt.dispute_status !== 'none') throw bad('You have already disputed this rating.', 'already_disputed');
  const text = str(req.body.text, { name: 'Reason', max: 500 });
  db.prepare("UPDATE project_ratings SET dispute = ?, dispute_status = 'open' WHERE project_id = ?").run(text, rt.project_id);
  await reports.createReport({ kind: 'rating', category: 'rating', bookingId: null, fromUser: req.user.id, againstUser: rt.client_id, text: `Project rating ${rt.stars}★ disputed (${rt.project_id}): ${text}` });
  res.json({ ok: true });
});

// ================= client (builder / architect / developer / owner) =================
const isClient = auth.requireRole('contractor');
function needClient(req) {
  if (!db.prepare('SELECT 1 FROM contractors WHERE user_id = ?').get(req.user.id)) throw new HttpError(403, 'Create your company profile first.', 'no_profile');
}
function ownProject(req) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND client_id = ?').get(req.params.id, req.user.id);
  if (!p) throw new HttpError(404, 'Project not found.', 'not_found');
  return p;
}
r.post('/client/projects', isClient, async (req, res) => { needClient(req); res.json(await P.createProject(req.user.id, req.body || {})); });
r.get('/client/projects', isClient, (req, res) => {
  const rows = db.prepare('SELECT * FROM projects WHERE client_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  res.json({ fees: P.fees(), projects: rows.map(p => {
    const quotes = db.prepare("SELECT * FROM quotes WHERE project_id = ? AND status IN ('submitted','accepted') ORDER BY amount").all(p.id).map(q => {
      const partner = P.getPartner(q.partner_id);
      if (!partner || partner.deleted_at) return null;
      const won = q.status === 'accepted' && p.payment_status === 'paid';
      return Object.assign(P.partnerCard(partner, req.user.id), { quote_id: q.id, amount: q.amount, days: q.days, note: q.note, status: q.status, phone: won ? partner.phone : null });
    }).filter(Boolean);
    return Object.assign(P.publicProject(p), { quotes, payment_status: p.payment_status, awarded_quote_id: p.awarded_quote_id, inspection_fee: p.inspection_fee, platform_fee: p.platform_fee,
      inspection_status: p.inspection_status, inspection_notes: p.inspection_notes, invited_only: p.invited_only,
      invited: db.prepare('SELECT COUNT(*) AS n FROM project_invites WHERE project_id = ?').get(p.id).n,
      rating: db.prepare('SELECT stars, comment, dispute_status FROM project_ratings WHERE project_id = ?').get(p.id) || null });
  }) });
});
r.post('/client/projects/:id/invite', isClient, async (req, res) => {
  const p = ownProject(req);
  if (p.status !== 'open') throw bad('This project is not open.');
  const ids = Array.isArray(req.body.partnerIds) ? req.body.partnerIds.map(String) : [];
  const added = P.inviteToProject(p, ids);
  await P.notifyLead(p, added);
  res.json({ ok: true, invited: added.length });
});
r.post('/client/projects/:id/complete', isClient, (req, res) => {
  const p = ownProject(req);
  if (p.status !== 'awarded') throw bad('Only an awarded project can be marked complete.');
  db.prepare("UPDATE projects SET status = 'completed', completed_at = ? WHERE id = ?").run(nowIso(), p.id);
  res.json({ ok: true });
});
r.post('/client/projects/:id/cancel', isClient, (req, res) => {
  const p = ownProject(req);
  if (p.status !== 'open') throw bad('Only an open project can be cancelled. For an awarded project, report a problem in Help.');
  db.prepare("UPDATE projects SET status = 'cancelled' WHERE id = ?").run(p.id);
  db.prepare("UPDATE quotes SET status = 'rejected', updated_at = ? WHERE project_id = ? AND status = 'submitted'").run(nowIso(), p.id);
  res.json({ ok: true });
});
r.post('/client/projects/:id/rate', isClient, (req, res) => {
  const p = ownProject(req);
  if (p.status !== 'completed') throw bad('You can rate after marking the project complete.', 'not_finished');
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Choose 1 to 5 stars.');
  const old = db.prepare('SELECT dispute_status FROM project_ratings WHERE project_id = ?').get(p.id);
  if (old && old.dispute_status !== 'none') throw bad('This rating is under review and cannot be changed.', 'disputed');
  const q = db.prepare('SELECT partner_id FROM quotes WHERE id = ?').get(p.awarded_quote_id);
  db.prepare(`INSERT INTO project_ratings (project_id, partner_id, client_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment`).run(p.id, q.partner_id, req.user.id, stars, str(req.body.comment, { name: 'Comment', max: 500, required: false }), nowIso());
  res.json({ ok: true });
});
// Directory of contractors and professionals (no phone numbers).
r.get('/client/partners', isClient, (req, res) => {
  const q = req.query, cat = q.category ? String(q.category) : '', city = String(q.city || '').trim().toLowerCase();
  let rows = db.prepare(`SELECT DISTINCT p.*, u.phone FROM partners p JOIN users u ON u.id = p.user_id ${cat ? 'JOIN partner_categories pc ON pc.partner_id = p.user_id AND pc.category_id = @cat' : ''}
    WHERE u.deleted_at IS NULL AND p.status = 'active' ORDER BY p.created_at DESC LIMIT 1000`).all(cat ? { cat } : {});
  rows = rows.filter(p => !require('../quality').blocked(p.user_id, req.user.id) && (!city || (p.city + ' ' + p.areas).toLowerCase().includes(city)) && (q.verified !== '1' || P.partnerVerified(p)));
  const minRating = Number(q.minRating) || 0;
  const cards = rows.map(p => P.partnerCard(p, req.user.id)).filter(c => !minRating || (c.stats.rating.avg || 0) >= minRating);
  cards.sort((a, b) => b.v.verified - a.v.verified || (b.stats.rating.avg || 0) - (a.stats.rating.avg || 0) || b.stats.completed - a.stats.completed);
  res.json({ partners: cards.slice(0, 200), total: cards.length });
});

module.exports = r;
