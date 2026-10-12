'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const auth = require('./auth');
const payments = require('./routes/payments');


function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://*.razorpay.com'],
        frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://*.razorpay.com'],
        connectSrc: ["'self'", 'https://*.razorpay.com'],
        imgSrc: ["'self'", 'data:', 'https://*.razorpay.com'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Webhook needs the raw body for signature checks, so it is mounted before the JSON parser.
  app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), (req, res, next) => payments.handleWebhook(req, res).catch(next));

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(auth.loadUser);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', require('./routes/account'));
  app.use('/api', payments.router);
  app.use('/api', require('./routes/work'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[error]', req.method, req.path, err);
    res.status(status).json({ error: status >= 500 && !err.code ? 'Something went wrong. Please try again.' : err.message, code: err.code || 'error' });
  });
  return app;
}

module.exports = { createApp };
