'use strict';
// Starting payments (bookings, worker membership, contractor plan), confirming them from checkout,
// and Razorpay webhooks. In test mode (no Razorpay keys) payments are simulated with a confirm step.
const express = require('express');
const config = require('../config');
const { db, getSettings } = require('../db');
const { id, nowIso, HttpError, bad } = require('../util');
const auth = require('../auth');
const rzp = require('../services/razorpay');
const domain = require('../domain');

const r = require('../router')();

function newPayment(userId, kind, refId, amount, extra = {}) {
  const row = { id: id('pay'), user_id: userId, kind, ref_id: refId, amount, rzp_order_id: null, rzp_subscription_id: null,
    status: 'created', test: config.razorpay.live ? 0 : 1, created_at: nowIso(), updated_at: nowIso(), ...extra };
  db.prepare(`INSERT INTO payments (id, user_id, kind, ref_id, amount, rzp_order_id, rzp_subscription_id, status, test, created_at, updated_at)
    VALUES (@id, @user_id, @kind, @ref_id, @amount, @rzp_order_id, @rzp_subscription_id, @status, @test, @created_at, @updated_at)`).run(row);
  return row;
}
function assertTestModeAllowed() {
  if (!config.allowTestMode) throw new HttpError(503, 'Online payments are not set up yet. Please contact Labour Katta.', 'payments_unavailable');
}
const prefill = (user) => ({ contact: '+91' + user.phone });

// ---- bookings ----
async function startBookingPayment(req, res, groupId, amount, extra) {
  const p = newPayment(req.user.id, 'booking', groupId, amount);
  if (!config.razorpay.live) {
    assertTestModeAllowed();
    return res.json(Object.assign({}, extra, { payment: { mode: 'test', paymentId: p.id, amount } }));
  }
  const order = await rzp.createOrder({ amount, receipt: p.id, notes: { payment_id: p.id, order_id: groupId } });
  db.prepare('UPDATE payments SET rzp_order_id = ? WHERE id = ?').run(order.id, p.id);
  res.json(Object.assign({}, extra, { payment: { mode: 'live', paymentId: p.id, amount, checkout: { key: config.razorpay.keyId, order_id: order.id, amount: order.amount, currency: 'INR', prefill: prefill(req.user) } } }));
}

r.post('/contractor/bookings', auth.requireRole('contractor'), async (req, res) => {
  const { groupId, bookingId, bookingIds, amountDue, needsPayment } = domain.createBooking(req.user.id, req.body);
  if (!needsPayment) { await domain.openGroup(groupId); return res.json({ groupId, bookingId, bookingIds, paid: true }); }
  await startBookingPayment(req, res, groupId, amountDue, { groupId, bookingId, bookingIds });
});

// Pay for an order that is still waiting for payment (any of its lines can be passed).
r.post('/contractor/bookings/:id/pay', auth.requireRole('contractor'), async (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE id = ? AND contractor_id = ? AND status = 'pending_payment'").get(req.params.id, req.user.id);
  if (!b) throw new HttpError(404, 'This booking does not need payment.', 'not_found');
  const amount = db.prepare("SELECT COALESCE(SUM(amount_due),0) AS n FROM bookings WHERE group_id = ? AND status = 'pending_payment'").get(b.group_id).n;
  await startBookingPayment(req, res, b.group_id, amount, {});
});

// ---- worker membership ----
r.post('/worker/membership', auth.requireRole('worker'), async (req, res) => {
  const w = domain.getWorker(req.user.id);
  if (!w) throw new HttpError(403, 'Create your worker profile first.', 'no_profile');
  if (w.membership_status === 'active') throw bad('Your membership is already active.');
  const s = getSettings();
  if (req.body.method === 'cash') {
    db.prepare("UPDATE workers SET membership_status = 'pending_cash', membership_method = 'cash' WHERE user_id = ?").run(w.user_id);
    return res.json({ ok: true, status: 'pending_cash', amount: domain.workerCashPrice(w, s) });
  }
  if (!config.razorpay.live) {
    assertTestModeAllowed();
    const p = newPayment(w.user_id, 'worker_membership', w.user_id, s.worker_first_month);
    return res.json({ payment: { mode: 'test', paymentId: p.id, amount: s.worker_first_month } });
  }
  const sub = await rzp.createWorkerSubscription({ monthly: domain.workerMonthlyPrice(w, s), firstMonth: Math.min(s.worker_first_month, domain.workerMonthlyPrice(w, s)), notes: { worker_id: w.user_id } });
  const p = newPayment(w.user_id, 'worker_membership', w.user_id, s.worker_first_month, { rzp_subscription_id: sub.id });
  db.prepare('UPDATE workers SET rzp_subscription_id = ? WHERE user_id = ?').run(sub.id, w.user_id);
  res.json({ payment: { mode: 'live', paymentId: p.id, amount: s.worker_first_month, checkout: { key: config.razorpay.keyId, subscription_id: sub.id, prefill: prefill(req.user) } } });
});

r.post('/worker/membership/cancel', auth.requireRole('worker'), async (req, res) => {
  const w = domain.getWorker(req.user.id);
  if (!w) throw new HttpError(404, 'No profile.', 'not_found');
  if (w.rzp_subscription_id && config.razorpay.live && w.membership_method === 'upi') await rzp.cancelSubscription(w.rzp_subscription_id);
  db.prepare("UPDATE workers SET membership_status = 'cancelled' WHERE user_id = ?").run(w.user_id);
  res.json({ ok: true });
});

// ---- contractor plan ----
r.post('/contractor/plan', auth.requireRole('contractor'), async (req, res) => {
  const c = domain.getContractor(req.user.id);
  if (!c) throw new HttpError(403, 'Create your company profile first.', 'no_profile');
  if (c.plan_status === 'active') throw bad('Your plan is already active.');
  const s = getSettings();
  if (!config.razorpay.live) {
    assertTestModeAllowed();
    const amount = domain.contractorPlanPrice(c, s);
    const p = newPayment(c.user_id, 'contractor_plan', c.user_id, amount);
    return res.json({ payment: { mode: 'test', paymentId: p.id, amount } });
  }
  const amount = domain.contractorPlanPrice(c, s);
  const sub = await rzp.createContractorSubscription({ monthly: amount, notes: { contractor_id: c.user_id } });
  const p = newPayment(c.user_id, 'contractor_plan', c.user_id, amount, { rzp_subscription_id: sub.id });
  db.prepare('UPDATE contractors SET rzp_subscription_id = ? WHERE user_id = ?').run(sub.id, c.user_id);
  res.json({ payment: { mode: 'live', paymentId: p.id, amount, checkout: { key: config.razorpay.keyId, subscription_id: sub.id, prefill: prefill(req.user) } } });
});

r.post('/contractor/plan/cancel', auth.requireRole('contractor'), async (req, res) => {
  const c = domain.getContractor(req.user.id);
  if (!c) throw new HttpError(404, 'No profile.', 'not_found');
  if (c.rzp_subscription_id && config.razorpay.live) await rzp.cancelSubscription(c.rzp_subscription_id);
  db.prepare("UPDATE contractors SET plan_status = 'cancelled' WHERE user_id = ?").run(c.user_id);
  res.json({ ok: true });
});

// ---- confirming payments ----
r.post('/payments/verify', auth.requireUser, async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_subscription_id: subId, razorpay_payment_id: payId, razorpay_signature: sig } = req.body;
  if (!config.razorpay.live) throw bad('Payments are in test mode.');
  let p;
  if (orderId) {
    if (!rzp.verifyOrderPayment(orderId, payId, sig)) throw bad('Payment could not be verified.', 'bad_signature');
    p = db.prepare('SELECT * FROM payments WHERE rzp_order_id = ? AND user_id = ?').get(orderId, req.user.id);
  } else if (subId) {
    if (!rzp.verifySubscriptionPayment(subId, payId, sig)) throw bad('Payment could not be verified.', 'bad_signature');
    p = db.prepare('SELECT * FROM payments WHERE rzp_subscription_id = ? AND user_id = ? ORDER BY created_at DESC').get(subId, req.user.id);
  }
  if (!p) throw new HttpError(404, 'Payment not found.', 'not_found');
  await domain.fulfilPayment(p.id, payId);
  res.json({ ok: true });
});

r.post('/payments/test-complete', auth.requireUser, async (req, res) => {
  if (config.razorpay.live || !config.allowTestMode) throw new HttpError(403, 'Test payments are switched off.', 'no_test');
  const p = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ? AND test = 1').get(String(req.body.paymentId || ''), req.user.id);
  if (!p) throw new HttpError(404, 'Payment not found.', 'not_found');
  await domain.fulfilPayment(p.id, 'test_' + p.id);
  res.json({ ok: true });
});

// ---- Razorpay webhooks (configure in Razorpay Dashboard → Webhooks) ----
async function handleWebhook(req, res) {
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  if (!rzp.verifyWebhook(raw, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'bad signature' });
  const eventId = req.get('x-razorpay-event-id');
  if (eventId) {
    const seen = db.prepare('INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)').run(eventId, nowIso()).changes === 0;
    if (seen) return res.json({ ok: true, duplicate: true });
  }
  const evt = JSON.parse(raw);
  const pay = evt.payload && evt.payload.payment && evt.payload.payment.entity;
  const sub = evt.payload && evt.payload.subscription && evt.payload.subscription.entity;
  try {
    if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && pay && pay.order_id) {
      const p = db.prepare('SELECT * FROM payments WHERE rzp_order_id = ?').get(pay.order_id);
      if (p) await domain.fulfilPayment(p.id, pay.id);
    } else if (['subscription.authenticated', 'subscription.activated', 'subscription.charged'].includes(evt.event) && sub) {
      const p = db.prepare('SELECT * FROM payments WHERE rzp_subscription_id = ? ORDER BY created_at DESC').get(sub.id);
      if (p) await domain.fulfilPayment(p.id, pay && pay.id);
    } else if (['subscription.halted', 'subscription.cancelled', 'subscription.completed'].includes(evt.event) && sub) {
      domain.deactivateBySubscription(sub.id);
    }
  } catch (e) {
    console.error('[webhook] handling failed', evt.event, e);
    if (eventId) db.prepare('DELETE FROM webhook_events WHERE id = ?').run(eventId); // let Razorpay retry
    return res.status(500).json({ error: 'handler failed' });
  }
  res.json({ ok: true });
}

module.exports = { router: r, handleWebhook };
