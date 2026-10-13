'use strict';
// Trust and matching: reliability history, ratings, automatic levels, distance, blocks and ranking.
// Everything here is computed from records (attendance, cancellations, ratings, verifications),
// so a badge or score never claims more than has actually been checked.
const { db } = require('./db');
const { todayIST } = require('./util');

const endDate = (b) => { const d = new Date(b.start_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + b.days - 1); return d.toISOString().slice(0, 10); };

/** Attendance and cancellation history. score is null until there are at least 3 records ("New"). */
function reliability(workerId) {
  const a = db.prepare(`SELECT SUM(status = 'present') AS present, SUM(status = 'late') AS late, SUM(status = 'absent') AS absent
    FROM attendance WHERE worker_id = ?`).get(workerId);
  const cancellations = db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE worker_id = ? AND status = 'declined'").get(workerId).n;
  const jobsDone = db.prepare(`SELECT COUNT(*) AS n FROM assignments a JOIN bookings b ON b.id = a.booking_id
    WHERE a.worker_id = ? AND a.status = 'active' AND b.status != 'cancelled' AND date(b.start_date, '+' || (b.days - 1) || ' days') < ?`).get(workerId, todayIST()).n;
  const present = a.present || 0, late = a.late || 0, absent = a.absent || 0;
  const records = present + late + absent + cancellations;
  const score = records >= 3 ? Math.round(100 * (present + late * 0.75) / records) : null;
  return { present, late, absent, cancellations, jobsDone, records, score };
}

/** Average of ratings that were not removed after a dispute. */
function ratingOf(workerId) {
  const r = db.prepare("SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE worker_id = ? AND dispute_status != 'removed'").get(workerId);
  return { avg: r.n ? Math.round(r.avg * 10) / 10 : null, count: r.n };
}

/**
 * Levels, earned automatically:
 *  Bronze – registered.
 *  Silver – Aadhaar e-KYC and photo checked by the Labour Katta team, and a complete profile (name, area, at least one skill).
 *  Gold   – Silver, plus a skill test passed with the Labour Katta team, at least 5 completed jobs,
 *           a reliability score of 85 or more and (if rated) an average rating of 4 or more.
 * The admin can cap a worker's level lower (tier_cap) but can never raise it above what the records support.
 */
const RANK = { bronze: 0, silver: 1, gold: 2 };
function computeTier(w) {
  const skills = db.prepare('SELECT COUNT(*) AS n FROM worker_skills WHERE worker_id = ?').get(w.user_id).n;
  let tier = 'bronze';
  if (w.verified_aadhaar && w.verified_photo && w.name && w.area && skills > 0) {
    tier = 'silver';
    const rel = reliability(w.user_id), rt = ratingOf(w.user_id);
    if (w.verified_test && rel.jobsDone >= 5 && rel.score != null && rel.score >= 85 && (rt.count === 0 || rt.avg >= 4)) tier = 'gold';
  }
  const cap = RANK[w.tier_cap] != null ? w.tier_cap : 'gold';
  return RANK[tier] <= RANK[cap] ? tier : cap;
}
function recomputeTier(workerId) {
  const w = db.prepare('SELECT * FROM workers WHERE user_id = ?').get(workerId);
  if (!w) return null;
  const tier = computeTier(w);
  if (tier !== w.tier) db.prepare('UPDATE workers SET tier = ? WHERE user_id = ?').run(tier, workerId);
  return tier;
}
function recomputeAllTiers() {
  for (const w of db.prepare('SELECT user_id FROM workers').all()) recomputeTier(w.user_id);
}
/** What the worker still needs for the next level (shown to the worker). */
function nextLevelSteps(w) {
  const out = [];
  const skills = db.prepare('SELECT COUNT(*) AS n FROM worker_skills WHERE worker_id = ?').get(w.user_id).n;
  if (!w.verified_aadhaar) out.push('id'); if (!w.verified_photo) out.push('photo');
  if (!w.area || !skills) out.push('profile');
  if (w.tier !== 'bronze') {
    const rel = reliability(w.user_id), rt = ratingOf(w.user_id);
    if (!w.verified_test) out.push('skill');
    if (rel.jobsDone < 5) out.push('jobs');
    if (rel.score == null || rel.score < 85) out.push('reliability');
    if (rt.count && rt.avg < 4) out.push('rating');
  }
  return out;
}

const builderVerified = (c) => Boolean(c && c.verified_id && (c.verified_gst || c.verified_site));
const cFlags = (c) => ({ phone: 1, id: c.verified_id ? 1 : 0, gst: c.verified_gst ? 1 : 0, site: c.verified_site ? 1 : 0, verified: builderVerified(c) ? 1 : 0 });

function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v == null || !Number.isFinite(Number(v)))) return null;
  const R = 6371, toR = (x) => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

const blocked = (a, b) => Boolean(db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a));

/** Off days the worker marked on their calendar, inside [start, end]. */
function hasOffDay(workerId, start, end) {
  return Boolean(db.prepare('SELECT 1 FROM worker_off_days WHERE worker_id = ? AND date BETWEEN ? AND ? LIMIT 1').get(workerId, start, end));
}
/** Worker's own availability for these dates: status, busy-until, calendar, travel radius. */
function availableFor(w, b) {
  const status = w.avail_status || (w.available === 0 ? 'unavailable' : 'available');
  if (status === 'unavailable') return false;
  if (status === 'busy' && w.busy_until && w.busy_until >= b.start_date) return false;
  if (hasOffDay(w.user_id, b.start_date, endDate(b))) return false;
  if (w.radius_km > 0) {
    const d = distanceKm(w.home_lat, w.home_lng, b.site_lat, b.site_lng);
    if (d != null && d > w.radius_km) return false;
  }
  return true;
}

const EXP_POINTS = { '0-1': 2, '1-3': 6, '3-5': 10, '5+': 15 };
/**
 * Match score out of 100 with the reasons shown to the builder:
 * distance 25, reliability 25, rating 15, experience 15, level 10, favourite 10.
 */
function matchScore(w, site, contractorId) {
  const d = site ? distanceKm(w.home_lat, w.home_lng, site.site_lat, site.site_lng) : null;
  const rel = reliability(w.user_id), rt = ratingOf(w.user_id);
  const fav = contractorId ? Boolean(db.prepare('SELECT 1 FROM favourites WHERE contractor_id = ? AND worker_id = ?').get(contractorId, w.user_id)) : false;
  let s = 0;
  s += d == null ? 10 : Math.max(0, 25 * (1 - d / 30));
  s += rel.score == null ? 12 : 25 * rel.score / 100;
  s += rt.avg == null ? 8 : 15 * rt.avg / 5;
  s += EXP_POINTS[w.experience] || 0;
  s += w.tier === 'gold' ? 10 : w.tier === 'silver' ? 5 : 0;
  s += fav ? 10 : 0;
  return { score: Math.round(s), distanceKm: d, reliability: rel, rating: rt, favourite: fav };
}

module.exports = { endDate, reliability, ratingOf, computeTier, recomputeTier, recomputeAllTiers, nextLevelSteps, builderVerified, cFlags, distanceKm, blocked, availableFor, hasOffDay, matchScore, RANK };
