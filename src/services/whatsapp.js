'use strict';
// Sends WhatsApp template messages through Meta's WhatsApp Cloud API.
// Without WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID every message is recorded in the outbox with status "test".
const config = require('../config');
const { db } = require('../db');
const { nowIso } = require('../util');
const { render, orderedParams } = require('./messages');

const insert = db.prepare(`INSERT INTO notifications (user_id, phone, template, params, body, status, provider_id, error, created_at)
  VALUES (@user_id, @phone, @template, @params, @body, @status, @provider_id, @error, @created_at)`);
const update = db.prepare('UPDATE notifications SET status = ?, provider_id = ?, error = ? WHERE id = ?');

async function callApi(payload) {
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || `WhatsApp API error ${res.status}`);
  return body.messages && body.messages[0] && body.messages[0].id;
}

/** Queue + send one template message. Never throws: failures are stored on the outbox row. */
async function sendTemplate({ userId = null, phone, lang = 'en', templateKey, params }) {
  const values = orderedParams(templateKey, params);
  const row = {
    user_id: userId, phone, template: templateKey, params: JSON.stringify(values),
    body: render(templateKey, lang, values), status: config.whatsapp.live ? 'queued' : 'test',
    provider_id: null, error: null, created_at: nowIso(),
  };
  const { lastInsertRowid } = insert.run(row);
  if (!config.whatsapp.live) return { id: lastInsertRowid, status: 'test' };
  try {
    const providerId = await callApi({
      messaging_product: 'whatsapp', to: '91' + phone, type: 'template',
      template: {
        name: config.whatsapp.templates[templateKey], language: { code: lang },
        components: [{ type: 'body', parameters: values.map(text => ({ type: 'text', text })) }],
      },
    });
    update.run('sent', providerId || null, null, lastInsertRowid);
    return { id: lastInsertRowid, status: 'sent' };
  } catch (e) {
    update.run('failed', null, String(e.message).slice(0, 500), lastInsertRowid);
    console.error('[whatsapp] send failed:', e.message);
    return { id: lastInsertRowid, status: 'failed' };
  }
}

/** One-time login code via an approved WhatsApp *authentication* template (copy-code button). */
async function sendOtp(phone, code, lang = 'en') {
  if (!config.whatsapp.live) return { status: 'test' };
  try {
    await callApi({
      messaging_product: 'whatsapp', to: '91' + phone, type: 'template',
      template: {
        name: config.whatsapp.templates.otp, language: { code: lang === 'en' ? 'en' : lang },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    });
    return { status: 'sent' };
  } catch (e) {
    console.error('[whatsapp] OTP send failed:', e.message);
    return { status: 'failed', error: e.message };
  }
}

module.exports = { sendTemplate, sendOtp };
