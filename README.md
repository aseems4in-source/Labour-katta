# Labour Katta

The Labour Katta app connects builders and contractors with skilled and unskilled construction workers in Mumbai. It is one Node.js server plus an installable mobile web app (PWA) in English, Hindi and Marathi.

- **Contractors** sign in with their phone and book workers by trade, count, days, level and site. They pay through Labour Katta or pay workers directly, see the assigned team with phone numbers, mark attendance, request replacements, and subscribe to the ₹599/month plan by UPI AutoPay.
- **Workers** sign in, pick their skills, and start a membership: ₹9 for the first month then ₹79/month by UPI AutoPay, or ₹79/month in cash. They get matching job offers on WhatsApp and in the app, accept jobs, see earnings and confirm direct cash payments.
- **Admins** edit every price and fee, add or remove skills (names in three languages), set worker tiers and custom wages, tick verifications, confirm cash memberships, and see bookings, payments and every WhatsApp message.

## Access rules
- The first screen asks **Contractor, Worker or Admin**. A phone number belongs to one portal only: a worker's number cannot sign in to the Contractor portal and the other way round.
- **Contractors pay the monthly plan (₹599 by default) upfront** before they can book. **Workers need an active membership** (₹9 then ₹79 by AutoPay, or ₹79 cash) to see job offers.
- Unpaid accounts get **no job offers and no WhatsApp notifications**. The exception is when an admin gives a **free trial** (Admin → Contractors/Workers → Give days) or a **special monthly price** for that account.
- **Admins** sign in with username and password and can open any contractor's or worker's portal (Admin → Contractors/Workers → Open), then return with **Back to Admin**.

## Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env      # put your own mobile number in ADMIN_PHONES
npm start                 # open http://localhost:3000
npm test                  # end-to-end check of the full booking flow
```

With no Razorpay or WhatsApp keys the app runs in **test mode**:
- The login code is shown on screen instead of being sent on WhatsApp.
- Payments show a "Mark as paid" step. No money moves.
- WhatsApp messages are saved to Admin → WhatsApp outbox and each user's Messages tab.

A yellow "Test mode" banner is shown until both integrations are live. In production (`NODE_ENV=production`) test mode is switched off: without keys, sign-in and payments refuse rather than fake it.

## Going live

### 1. Server
Any host that runs Docker or Node.js and gives you a **persistent disk** works, for example Render (Web Service with a Disk mounted at `/data`), Railway (volume at `/data`), or a small AWS Lightsail / DigitalOcean server.

1. Deploy this folder (the `Dockerfile` is ready).
2. Set the environment variables from `.env.example` in the host's settings: `NODE_ENV=production`, a long random `JWT_SECRET`, `ADMIN_USERNAME` and `ADMIN_PASSWORD` (Admin login on the sign-in screen), optionally `ADMIN_PHONES`, `BASE_URL` (your https address) and `DB_FILE=/data/labour-katta.db`. Use a strong admin password of 12+ characters. Wrong passwords lock that device out for 15 minutes after 5 tries.
3. Point your domain at it with HTTPS (hosts do this for you).
4. **Back up `/data/labour-katta.db` every day.** It holds all users, bookings and payments. Most hosts offer disk snapshots.

### 2. Razorpay (payments and UPI AutoPay)
1. Activate your Razorpay account (business KYC) and enable **Subscriptions** with **UPI AutoPay**.
2. Dashboard → API Keys: put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the server settings. Never in the app or in chat.
3. Dashboard → Webhooks → add `https://YOUR-DOMAIN/api/webhooks/razorpay` with a secret, and set it as `RAZORPAY_WEBHOOK_SECRET`. Tick these events: `payment.captured`, `order.paid`, `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`.
4. Use **test keys first** (`rzp_test_…`) and run through: a booking paid through Labour Katta, the worker ₹9→₹79 membership, and the ₹599 contractor plan. The ₹9 first month is a one-time add-on charged when the AutoPay mandate is set up, with the ₹79 plan starting 30 days later. Confirm this shows correctly in Razorpay's test checkout before switching to live keys.
5. Plans are created automatically. When an admin changes a price, new subscriptions use a new plan at the new price. Existing subscribers stay on their old price.

### 3. WhatsApp (Meta WhatsApp Cloud API)
1. In Meta Business Manager, complete business verification and add a WhatsApp phone number.
2. Create a **System User** with a permanent token that has `whatsapp_business_messaging`. Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.
3. Create and get approval for the templates in [`docs/whatsapp-templates.md`](docs/whatsapp-templates.md) in en, hi and mr.
4. Each message is logged in Admin → WhatsApp outbox as `sent` or `failed`, with the error if it failed.

If you use a provider such as Gupshup or Interakt instead of Meta directly, only `src/services/whatsapp.js` needs changing.

### 4. Before public launch
- Privacy policy and terms of use. You store phone numbers, verification status and UPI IDs, so India's DPDP Act applies.
- Decide the legal status of workers (employees, contract labour or platform workers) with a CA or labour lawyer. This affects PF/ESIC, insurance and licences.
- Optional: publish to Google Play as a Trusted Web Activity (TWA) wrapper around this PWA, using Bubblewrap or PWABuilder.

## Android app (APK)
The `android/` folder is a native Android app that opens your live Labour Katta server full-screen. It handles UPI apps for Razorpay payments, WhatsApp and phone links, the back button, and an offline screen in three languages. Deploy the server first, because the app needs its https address.

**Build in the cloud with GitHub (no setup on your computer):**
1. Put this project in a GitHub repository.
2. Repo → Settings → Secrets and variables → Actions → **Variables** → add `APP_URL` = your server address, e.g. `https://app.labourkatta.in`.
3. Actions tab → **Build Android APK** → Run workflow. After about 5 minutes, download `labour-katta-android` from the run's Artifacts. It contains the APK.
4. Without signing secrets you get a **debug APK**, fine for installing on phones for the pilot ("Install unknown apps" must be allowed). For Google Play, create an upload key once (`keytool -genkeypair -v -keystore release.jks -alias labourkatta -keyalg RSA -keysize 2048 -validity 10000`) and add `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` as **Secrets**. The workflow then also produces a signed release APK and an `.aab` for Play Console. Keep `release.jks` safe: you need the same key for every update.

**Or build on a computer:** open the `android/` folder in Android Studio, set `appUrl` in `android/gradle.properties`, then Build → Build APK(s).

## Not included yet
- **Wage payouts to workers.** Saturday payouts need RazorpayX Payouts or Cashfree Payouts. Earnings are tracked in the app; transfers are done manually until this is added.
- **Automated Aadhaar e-KYC.** Admins tick verifications after checking documents at the Katta centre. Connect a licensed e-KYC provider later, and store only the result.
- **Automatic refunds.** Cancelled paid bookings are refunded from the Razorpay dashboard. The app tells the contractor the team will contact them.

## Project layout
```
src/server.js            start the server
src/app.js               security headers, routes, error handling
src/config.js            environment settings (keys live here, server-side only)
src/db.js                SQLite schema, migrations, default skills and prices
src/domain.js            pricing, matching, accepting jobs, payment fulfilment
src/routes/              account/login, bookings & jobs, payments & webhooks, admin
src/services/            Razorpay client, WhatsApp client, message templates
public/                  the mobile web app (index.html, app.js, i18n.js, styles.css, service worker)
test/smoke.test.js       end-to-end test in test mode
docs/                    WhatsApp template texts
```

## Security notes
- Login is by WhatsApp one-time code. Codes are hashed, expire after 5 minutes, and lock after 5 wrong tries. Requests are rate-limited.
- Sessions are signed, http-only cookies (secure in production).
- Payment success is only trusted after Razorpay signature checks, from checkout or webhooks. Webhooks are idempotent.
- A booking can never be over-filled: accepting a job runs in a database transaction.
