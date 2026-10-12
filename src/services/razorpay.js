'use strict';
// Minimal Razorpay REST client: orders (one-time booking payments), plans and subscriptions (UPI AutoPay),
// and signature checks for checkout callbacks and webhooks. Amounts in this app are rupees; Razorpay wants paise.
const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');

const API = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  if (!config.razorpay.live) throw new Error('Razorpay is not configured');
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.description) || `Razorpay error ${res.status}`;
    const err = new Error(msg); err.status = 502; throw err;
  }
  return json;
}

const paise = (rupees) => Math.round(Number(rupees) * 100);

function createOrder({ amount, receipt, notes }) {
  return call('POST', '/orders', { amount: paise(amount), currency: 'INR', receipt: String(receipt).slice(0, 40), notes });
}

// Plans are immutable in Razorpay, so each (kind, amount) gets its own plan, created once and cached.
async function ensurePlan(kind, amount, name) {
  const row = db.prepare('SELECT plan_id FROM rzp_plans WHERE kind = ? AND amount = ?').get(kind, amount);
  if (row) return row.plan_id;
  const plan = await call('POST', '/plans', {
    period: 'monthly', interval: 1,
    item: { name, amount: paise(amount), currency: 'INR', description: name },
    notes: { kind },
  });
  db.prepare('INSERT OR REPLACE INTO rzp_plans (kind, amount, plan_id) VALUES (?, ?, ?)').run(kind, amount, plan.id);
  return plan.id;
}

/**
 * Worker membership: first month at the trial price, then the monthly price until cancelled.
 * Implemented as a monthly plan starting 30 days from now, plus a one-time add-on equal to the trial price,
 * which the customer pays when authorising the UPI AutoPay mandate. Verify this flow in Razorpay test mode
 * before going live.
 */
async function createWorkerSubscription({ monthly, firstMonth, notes }) {
  const planId = await ensurePlan('worker_membership', monthly, `Labour Katta worker membership ₹${monthly}/month`);
  const startAt = Math.floor(Date.now() / 1000) + 30 * 86400;
  const body = { plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1, start_at: startAt, notes };
  if (firstMonth > 0) body.addons = [{ item: { name: 'First month', amount: paise(firstMonth), currency: 'INR' } }];
  return call('POST', '/subscriptions', body);
}

async function createContractorSubscription({ monthly, notes }) {
  const planId = await ensurePlan('contractor_plan', monthly, `Labour Katta contractor plan ₹${monthly}/month`);
  return call('POST', '/subscriptions', { plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1, notes });
}

function cancelSubscription(subscriptionId) {
  return call('POST', `/subscriptions/${subscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
}

function hmac(data, secret) { return crypto.createHmac('sha256', secret).update(data).digest('hex'); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const verifyOrderPayment = (orderId, paymentId, signature) => safeEqual(hmac(`${orderId}|${paymentId}`, config.razorpay.keySecret), signature);
const verifySubscriptionPayment = (subscriptionId, paymentId, signature) => safeEqual(hmac(`${paymentId}|${subscriptionId}`, config.razorpay.keySecret), signature);
const verifyWebhook = (rawBody, signature) => Boolean(config.razorpay.webhookSecret) && safeEqual(hmac(rawBody, config.razorpay.webhookSecret), signature || '');

module.exports = {
  createOrder, createWorkerSubscription, createContractorSubscription, cancelSubscription,
  verifyOrderPayment, verifySubscriptionPayment, verifyWebhook,
};
