'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     phone TEXT NOT NULL UNIQUE,
     role TEXT CHECK (role IN ('worker','contractor')),
     lang TEXT NOT NULL DEFAULT 'en',
     created_at TEXT NOT NULL
   );
   CREATE TABLE otps (
     phone TEXT PRIMARY KEY,
     code_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     sent_at INTEGER NOT NULL
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE skills (
     id TEXT PRIMARY KEY,
     en TEXT NOT NULL, hi TEXT NOT NULL DEFAULT '', mr TEXT NOT NULL DEFAULT '',
     cat TEXT NOT NULL CHECK (cat IN ('skilled','unskilled')),
     wage INTEGER NOT NULL CHECK (wage >= 0),
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL
   );
   CREATE TABLE contractors (
     user_id TEXT PRIMARY KEY REFERENCES users(id),
     company TEXT NOT NULL,
     gst TEXT NOT NULL DEFAULT '',
     plan_status TEXT NOT NULL DEFAULT 'none',
     plan_since TEXT,
     rzp_subscription_id TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE workers (
     user_id TEXT PRIMARY KEY REFERENCES users(id),
     name TEXT NOT NULL,
     area TEXT NOT NULL DEFAULT '',
     experience TEXT NOT NULL DEFAULT '',
     upi_id TEXT NOT NULL DEFAULT '',
     tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold')),
     custom_wage INTEGER,
     verified_aadhaar INTEGER NOT NULL DEFAULT 0,
     verified_photo INTEGER NOT NULL DEFAULT 0,
     verified_bank INTEGER NOT NULL DEFAULT 0,
     verified_test INTEGER NOT NULL DEFAULT 0,
     membership_status TEXT NOT NULL DEFAULT 'none',
     membership_method TEXT,
     membership_since TEXT,
     rzp_subscription_id TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE worker_skills (
     worker_id TEXT NOT NULL REFERENCES workers(user_id),
     skill_id TEXT NOT NULL REFERENCES skills(id),
     PRIMARY KEY (worker_id, skill_id)
   );
   CREATE TABLE bookings (
     id TEXT PRIMARY KEY,
     contractor_id TEXT NOT NULL REFERENCES contractors(user_id),
     skill_id TEXT NOT NULL REFERENCES skills(id),
     skill_en TEXT NOT NULL, skill_hi TEXT NOT NULL, skill_mr TEXT NOT NULL,
     count INTEGER NOT NULL, days INTEGER NOT NULL,
     level TEXT NOT NULL, qc INTEGER NOT NULL DEFAULT 0,
     pay_mode TEXT NOT NULL CHECK (pay_mode IN ('lk','direct')),
     site TEXT NOT NULL, start_date TEXT NOT NULL,
     wage INTEGER NOT NULL, price INTEGER NOT NULL,
     job_fee INTEGER NOT NULL, qc_cost INTEGER NOT NULL,
     total INTEGER NOT NULL, fee_now INTEGER NOT NULL, wages_you INTEGER NOT NULL,
     amount_due INTEGER NOT NULL,
     payment_status TEXT NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX bookings_status ON bookings(status);
   CREATE INDEX bookings_contractor ON bookings(contractor_id);
   CREATE TABLE assignments (
     booking_id TEXT NOT NULL REFERENCES bookings(id),
     worker_id TEXT NOT NULL REFERENCES workers(user_id),
     status TEXT NOT NULL DEFAULT 'active',
     assigned_at TEXT NOT NULL,
     paid_confirmation TEXT,
     PRIMARY KEY (booking_id, worker_id)
   );
   CREATE TABLE attendance (
     booking_id TEXT NOT NULL, worker_id TEXT NOT NULL, date TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('present','late','absent')),
     marked_at TEXT NOT NULL,
     PRIMARY KEY (booking_id, worker_id, date)
   );
   CREATE TABLE notifications (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT, phone TEXT NOT NULL,
     template TEXT NOT NULL, params TEXT NOT NULL, body TEXT NOT NULL,
     status TEXT NOT NULL, provider_id TEXT, error TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX notifications_user ON notifications(user_id);
   CREATE TABLE payments (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('booking','worker_membership','contractor_plan')),
     ref_id TEXT NOT NULL,
     amount INTEGER NOT NULL,
     rzp_order_id TEXT, rzp_subscription_id TEXT, rzp_payment_id TEXT,
     status TEXT NOT NULL,
     test INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   );
   CREATE INDEX payments_order ON payments(rzp_order_id);
   CREATE INDEX payments_sub ON payments(rzp_subscription_id);
   CREATE TABLE rzp_plans (kind TEXT NOT NULL, amount INTEGER NOT NULL, plan_id TEXT NOT NULL, PRIMARY KEY (kind, amount));
   CREATE TABLE webhook_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL);`,
  // 2: free trials and special prices granted by admin
  `ALTER TABLE contractors ADD COLUMN trial_until TEXT;
   ALTER TABLE contractors ADD COLUMN custom_price INTEGER;
   ALTER TABLE workers ADD COLUMN trial_until TEXT;
   ALTER TABLE workers ADD COLUMN custom_price INTEGER;`,
  // 3: one order can hold several lines (e.g. 4 masons + 6 helpers); site address and map pin
  `ALTER TABLE bookings ADD COLUMN group_id TEXT;
   ALTER TABLE bookings ADD COLUMN site_address TEXT NOT NULL DEFAULT '';
   ALTER TABLE bookings ADD COLUMN site_lat REAL;
   ALTER TABLE bookings ADD COLUMN site_lng REAL;
   UPDATE bookings SET group_id = id WHERE group_id IS NULL;
   CREATE INDEX bookings_group ON bookings(group_id);`,
  // 4: workers can switch themselves off ("not available for work")
  `ALTER TABLE workers ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
   CREATE INDEX assignments_worker ON assignments(worker_id);`,
  // 5: platform fee, deleted accounts, coupons, supervisors and their workload
  `ALTER TABLE users ADD COLUMN deleted_at TEXT;
   ALTER TABLE bookings ADD COLUMN platform_fee INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE bookings ADD COLUMN supervisor_id TEXT;
   CREATE TABLE coupons (
     id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE,
     applies_to TEXT NOT NULL CHECK (applies_to IN ('builder','worker','both')),
     kind TEXT NOT NULL CHECK (kind IN ('percent','flat','days')),
     value INTEGER NOT NULL, max_uses INTEGER, expires TEXT, active INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL
   );
   CREATE TABLE coupon_redemptions (user_id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL, redeemed_at TEXT NOT NULL);
   CREATE TABLE staff_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, perms TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
   CREATE TABLE staff_users (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL,
     phone TEXT NOT NULL DEFAULT '', group_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
   );
   CREATE INDEX bookings_supervisor ON bookings(supervisor_id);`,
  // 6: worker "I have reached the site" check-ins, confirmed by the builder or supervisor as attendance.
  `CREATE TABLE checkins (
     booking_id TEXT NOT NULL, worker_id TEXT NOT NULL, date TEXT NOT NULL, at TEXT NOT NULL,
     PRIMARY KEY (booking_id, worker_id, date)
   );`,
  // 7: availability calendar, travel radius, automatic levels, builder verification, overtime, wage finalising,
  //    confirmations and reminders, ratings and disputes, favourites and teams, reports and blocks.
  `ALTER TABLE workers ADD COLUMN avail_status TEXT NOT NULL DEFAULT 'available';
   ALTER TABLE workers ADD COLUMN busy_until TEXT;
   ALTER TABLE workers ADD COLUMN home_lat REAL;
   ALTER TABLE workers ADD COLUMN home_lng REAL;
   ALTER TABLE workers ADD COLUMN radius_km INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE workers ADD COLUMN tier_cap TEXT NOT NULL DEFAULT 'gold';
   UPDATE workers SET avail_status = CASE WHEN available = 0 THEN 'unavailable' ELSE 'available' END;
   ALTER TABLE contractors ADD COLUMN verified_id INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE contractors ADD COLUMN verified_gst INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE contractors ADD COLUMN verified_site INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE bookings ADD COLUMN report_time TEXT NOT NULL DEFAULT '09:00';
   ALTER TABLE bookings ADD COLUMN ot_rate INTEGER;
   ALTER TABLE bookings ADD COLUMN prefer TEXT;
   ALTER TABLE attendance ADD COLUMN ot_hours REAL NOT NULL DEFAULT 0;
   ALTER TABLE attendance ADD COLUMN note TEXT NOT NULL DEFAULT '';
   ALTER TABLE assignments ADD COLUMN confirmed_at TEXT;
   ALTER TABLE assignments ADD COLUMN wages_final_at TEXT;
   ALTER TABLE assignments ADD COLUMN wages_final_amount INTEGER;
   CREATE TABLE worker_off_days (worker_id TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (worker_id, date));
   CREATE TABLE ratings (
     booking_id TEXT NOT NULL, worker_id TEXT NOT NULL, contractor_id TEXT NOT NULL,
     stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '',
     dispute TEXT NOT NULL DEFAULT '', dispute_status TEXT NOT NULL DEFAULT 'none',
     created_at TEXT NOT NULL, PRIMARY KEY (booking_id, worker_id)
   );
   CREATE INDEX ratings_worker ON ratings(worker_id);
   CREATE TABLE favourites (contractor_id TEXT NOT NULL, worker_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (contractor_id, worker_id));
   CREATE TABLE teams (id TEXT PRIMARY KEY, contractor_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE team_members (team_id TEXT NOT NULL, worker_id TEXT NOT NULL, skill_id TEXT NOT NULL, PRIMARY KEY (team_id, worker_id));
   CREATE TABLE reports (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, urgent INTEGER NOT NULL DEFAULT 0,
     booking_id TEXT, from_user TEXT NOT NULL, against_user TEXT, text TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open', resolution TEXT NOT NULL DEFAULT '', resolved_by TEXT,
     created_at TEXT NOT NULL, resolved_at TEXT
   );
   CREATE INDEX reports_status ON reports(status);
   CREATE TABLE blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (blocker_id, blocked_id));
   CREATE TABLE reminders (booking_id TEXT NOT NULL, worker_id TEXT NOT NULL, kind TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (booking_id, worker_id, kind));
   CREATE TABLE site_notices (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, text TEXT NOT NULL, sent_by TEXT NOT NULL, created_at TEXT NOT NULL);`,
];

db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
const current = (db.prepare('SELECT version FROM schema_version').get() || { version: 0 }).version;
if (!db.prepare('SELECT 1 FROM schema_version').get()) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
for (let i = current; i < MIGRATIONS.length; i++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[i]);
    db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
  })();
}

// ---- seed defaults (only when empty) ----
const DEFAULT_SETTINGS = {
  worker_first_month: 9, worker_monthly: 79, worker_cash_monthly: 79,
  contractor_plan: 599, job_fee: 99, qc_per_day: 500, margin_per_worker_day: 150,
  silver_bonus: 50, gold_bonus: 100, worker_membership_required: 1, platform_fee_per_worker: 20,
  ot_multiplier: 2, reminder_hour: 18, confirm_hours_before: 2,
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, String(v));

const DEFAULT_SKILLS = [
  ['skilled', 'Mason', 'मिस्त्री (चिनाई)', 'गवंडी', 900], ['skilled', 'RCC / Shuttering', 'RCC / शटरिंग', 'RCC / शटरिंग', 950],
  ['skilled', 'Bar bender', 'बार बेंडर', 'बार बेंडर', 950], ['skilled', 'Carpenter', 'बढ़ई', 'सुतार', 950],
  ['skilled', 'Furniture carpenter', 'फ़र्नीचर बढ़ई', 'फर्निचर सुतार', 1000], ['skilled', 'POP / False ceiling', 'POP / फ़ॉल्स सीलिंग', 'POP / फॉल्स सीलिंग', 950],
  ['skilled', 'Tile fitter', 'टाइल फिटर', 'टाइल फिटर', 900], ['skilled', 'Painter', 'पेंटर', 'पेंटर', 800],
  ['skilled', 'Plumber', 'प्लंबर', 'प्लंबर', 950], ['skilled', 'Electrician', 'इलेक्ट्रीशियन', 'इलेक्ट्रिशियन', 950],
  ['skilled', 'Welder / Fabricator', 'वेल्डर / फ़ैब्रिकेटर', 'वेल्डर / फॅब्रिकेटर', 1000], ['skilled', 'Waterproofing', 'वॉटरप्रूफ़िंग', 'वॉटरप्रूफिंग', 900],
  ['skilled', 'Marble / Granite', 'मार्बल / ग्रेनाइट', 'मार्बल / ग्रॅनाइट', 1000], ['skilled', 'Aluminium / Glass', 'एल्युमिनियम / काँच', 'ॲल्युमिनियम / काच', 950],
  ['unskilled', 'Helper', 'हेल्पर', 'हेल्पर', 600], ['unskilled', 'Loading / Unloading', 'लोडिंग / अनलोडिंग', 'लोडिंग / अनलोडिंग', 650],
  ['unskilled', 'Digging', 'खुदाई', 'खोदकाम', 650], ['unskilled', 'Site cleaning', 'साइट सफ़ाई', 'साइट सफाई', 550],
  ['unskilled', 'Curing (watering)', 'क्यूरिंग (पानी)', 'क्युरिंग (पाणी)', 550], ['unskilled', 'Watchman', 'चौकीदार', 'वॉचमन', 600],
];
if (db.prepare('SELECT COUNT(*) AS n FROM skills').get().n === 0) {
  const ins = db.prepare('INSERT INTO skills (id, cat, en, hi, mr, wage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const now = new Date().toISOString();
  db.transaction(() => DEFAULT_SKILLS.forEach((s, i) => ins.run('s' + String(i + 1).padStart(2, '0'), s[0], s[1], s[2], s[3], s[4], now)))();
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = Number(r.value);
  return out;
}

module.exports = { db, getSettings, DEFAULT_SETTINGS };
