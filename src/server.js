'use strict';
const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
app.listen(config.port, () => {
  console.log(`Labour Katta running on ${config.baseUrl}`);
  console.log(`Payments: ${config.razorpay.live ? 'LIVE (Razorpay)' : 'test mode'} · WhatsApp: ${config.whatsapp.live ? 'LIVE (Cloud API)' : 'test mode'}`);
  if (!config.adminPhones.length) console.warn('No ADMIN_PHONES set: nobody can open the Admin panel.');
});
