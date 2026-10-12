'use strict';
// Loads settings from environment variables (and a local .env file in development).
// Secrets (Razorpay key secret, WhatsApp token, JWT secret) must only ever live here, on the server.
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'labour-katta.db'),
  jwtSecret: env.JWT_SECRET || (isProd ? '' : 'dev-only-secret-change-me'),
  adminPhones: (env.ADMIN_PHONES || '').split(',').map(s => s.replace(/\D/g, '').slice(-10)).filter(Boolean),
  timezone: 'Asia/Kolkata',

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
    // Approved template names in your WhatsApp Business account. Override if you name them differently.
    templates: {
      otp: env.WA_TPL_OTP || 'lk_otp',
      bookingReceived: env.WA_TPL_BOOKING_RECEIVED || 'lk_booking_received',
      teamReady: env.WA_TPL_TEAM_READY || 'lk_team_ready',
      jobConfirmed: env.WA_TPL_JOB_CONFIRMED || 'lk_job_confirmed',
      jobOffer: env.WA_TPL_JOB_OFFER || 'lk_job_offer',
      replacement: env.WA_TPL_REPLACEMENT || 'lk_replacement',
      planStarted: env.WA_TPL_PLAN_STARTED || 'lk_plan_started',
      membershipStarted: env.WA_TPL_MEMBERSHIP_STARTED || 'lk_membership_started',
      paymentIssue: env.WA_TPL_PAYMENT_ISSUE || 'lk_payment_issue',
    },
  },
};

config.razorpay.live = Boolean(config.razorpay.keyId && config.razorpay.keySecret);
config.whatsapp.live = Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
// Test helpers (simulated payments, OTP shown on screen) are only allowed outside production
// or when an integration is not configured AND ALLOW_TEST_MODE=1 is set explicitly.
config.allowTestMode = !isProd || env.ALLOW_TEST_MODE === '1';

if (isProd && !config.jwtSecret) {
  throw new Error('JWT_SECRET must be set in production.');
}
if (isProd && config.razorpay.live && !config.razorpay.webhookSecret) {
  throw new Error('RAZORPAY_WEBHOOK_SECRET must be set when Razorpay keys are configured.');
}

module.exports = config;
