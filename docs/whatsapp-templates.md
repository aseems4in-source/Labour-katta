# WhatsApp message templates

Create these in **WhatsApp Manager → Message templates** before going live. Category: **Utility** (except the login code, which is **Authentication**). Create each one in English (en), Hindi (hi) and Marathi (mr) with the same name. Placeholders must stay in this order.

## lk_otp (Authentication)

Use Meta's built-in authentication template with a **Copy code** button. The app sends the 6-digit code as the body parameter and as the button parameter. Languages: en, hi, mr.

## lk_booking_received (Utility)

Parameters: {{1}} = count, {{2}} = skill, {{3}} = site, {{4}} = date

- **en**: Labour Katta: Booking received for {{1}} × {{2}} at {{3}}, starting {{4}}. We are finding workers and will message you when the team is ready.
- **hi**: लेबर कट्टा: {{3}} पर {{1}} × {{2}} की बुकिंग मिली, {{4}} से। हम मज़दूर ढूँढ रहे हैं, टीम तैयार होते ही मैसेज करेंगे।
- **mr**: लेबर कट्टा: {{3}} येथे {{1}} × {{2}} ची बुकिंग मिळाली, {{4}} पासून. आम्ही कामगार शोधत आहोत, टीम तयार होताच मेसेज करू.

## lk_team_ready (Utility)

Parameters: {{1}} = count, {{2}} = skill, {{3}} = site, {{4}} = date

- **en**: Labour Katta: Your team is ready. {{1}} × {{2}} confirmed for {{3}}, starting {{4}}. Open the app to see names and call them.
- **hi**: लेबर कट्टा: आपकी टीम तैयार है। {{3}} के लिए {{1}} × {{2}} पक्के, {{4}} से। नाम देखने और कॉल करने के लिए ऐप खोलें।
- **mr**: लेबर कट्टा: तुमची टीम तयार आहे. {{3}} साठी {{1}} × {{2}} पक्के, {{4}} पासून. नावे पाहण्यासाठी आणि कॉल करण्यासाठी ॲप उघडा.

## lk_job_confirmed (Utility)

Parameters: {{1}} = skill, {{2}} = site, {{3}} = date, {{4}} = company, {{5}} = phone

- **en**: Labour Katta: Job confirmed. {{1}} at {{2}}, starting {{3}}. Contractor: {{4}} ({{5}}).
- **hi**: लेबर कट्टा: काम पक्का। {{2}} पर {{1}}, {{3}} से। ठेकेदार: {{4}} ({{5}})।
- **mr**: लेबर कट्टा: काम पक्के. {{2}} येथे {{1}}, {{3}} पासून. ठेकेदार: {{4}} ({{5}}).

## lk_job_offer (Utility)

Parameters: {{1}} = skill, {{2}} = site, {{3}} = date, {{4}} = wage

- **en**: Labour Katta: New job for you. {{1}} at {{2}}, starting {{3}}. Pay {{4}} per day. Open the app to accept.
- **hi**: लेबर कट्टा: आपके लिए नया काम। {{2}} पर {{1}}, {{3}} से। रोज़ {{4}}। स्वीकार करने के लिए ऐप खोलें।
- **mr**: लेबर कट्टा: तुमच्यासाठी नवीन काम. {{2}} येथे {{1}}, {{3}} पासून. दररोज {{4}}. स्वीकारण्यासाठी ॲप उघडा.

## lk_replacement (Utility)

Parameters: {{1}} = site

- **en**: Labour Katta: Replacement requested for {{1}}. We are assigning a new worker now.
- **hi**: लेबर कट्टा: {{1}} के लिए दूसरे मज़दूर का अनुरोध मिला। हम नया मज़दूर तय कर रहे हैं।
- **mr**: लेबर कट्टा: {{1}} साठी दुसऱ्या कामगाराची विनंती मिळाली. आम्ही नवीन कामगार ठरवत आहोत.

## lk_plan_started (Utility)

Parameters: {{1}} = amount

- **en**: Labour Katta: Your contractor plan is active. {{1}} per month by UPI AutoPay until you cancel. No job fee while the plan is active.
- **hi**: लेबर कट्टा: आपका ठेकेदार प्लान चालू है। बंद करने तक UPI ऑटोपे से हर महीने {{1}}। प्लान चालू रहने तक कोई जॉब फ़ीस नहीं।
- **mr**: लेबर कट्टा: तुमचा ठेकेदार प्लान सुरू आहे. बंद करेपर्यंत UPI ऑटोपेने दरमहा {{1}}. प्लान सुरू असेपर्यंत जॉब फी नाही.

## lk_membership_started (Utility)

Parameters: {{1}} = method

- **en**: Labour Katta: Your membership is active ({{1}}). You will now get job offers on WhatsApp and in the app.
- **hi**: लेबर कट्टा: आपकी सदस्यता चालू है ({{1}})। अब आपको WhatsApp और ऐप पर काम के ऑफर मिलेंगे।
- **mr**: लेबर कट्टा: तुमचे सदस्यत्व सुरू आहे ({{1}}). आता तुम्हाला WhatsApp आणि ॲपवर कामाच्या ऑफर मिळतील.

## lk_payment_issue (Utility)

Parameters: {{1}} = worker, {{2}} = site

- **en**: Labour Katta admin: {{1}} reported NOT receiving direct payment for {{2}}. Please call the contractor.
- **hi**: लेबर कट्टा एडमिन: {{1}} ने {{2}} का सीधा भुगतान नहीं मिलने की शिकायत की। कृपया ठेकेदार को कॉल करें।
- **mr**: लेबर कट्टा ॲडमिन: {{1}} यांनी {{2}} चे थेट पेमेंट न मिळाल्याची तक्रार केली. कृपया ठेकेदाराला कॉल करा.

Template names can be changed with the WA_TPL_* environment variables (see .env.example).

## New templates (October update)

Create these as **Utility** templates in en, hi and mr. The text for each language is in `src/services/messages.js`.

| Template name | Sent to | When | Variables in order |
|---|---|---|---|
| lk_worker_assigned | Builder | Each worker is assigned | name, skill, site, filled, total |
| lk_worker_checkin | Builder | Worker taps "I have reached the site" | name, site, time |
| lk_worker_cancelled | Builder | Worker says they can't come | name, site |
| lk_booking_cancelled | Worker | Builder cancels, or admin deletes the builder | site, date, company |

Until these are approved, the app still records the messages in the WhatsApp outbox and in the app's Messages tab.

## Phase 2 templates

| Template name | Sent to | When | Variables in order |
|---|---|---|---|
| lk_job_reminder | Worker | Evening before the job (admin sets the hour) | site, date, time, address |
| lk_not_confirmed | Builder | Worker hasn't tapped "I will come" by reporting time minus N hours | name, site, time |
| lk_site_notice | Workers on a site | Builder/supervisor sends an urgent message | company, site, text |
| lk_wages_final | Worker | Builder finalises wages | site, days, amount |
| lk_urgent_report | Admin phones + site supervisor | Urgent report or accident | category, from, text |

## Ask for more money and automatic replacement

| Template name | Sent to | When | Variables in order |
|---|---|---|---|
| lk_counter_offer | Builder | A worker asks for a higher wage and/or travel money | name, skill, site, wage, travel |
| lk_counter_declined | Worker | The builder declines the request | site, wage |
| lk_auto_replaced | Builder | A worker says no and another worker is put on at no extra cost | old, new, site |
