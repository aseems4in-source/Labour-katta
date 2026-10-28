'use strict';
// WhatsApp template bodies. Each template takes its parameters in this exact order.
// Create matching templates in WhatsApp Manager (one per language: en, hi, mr) with {{1}}, {{2}}… placeholders
// in the same order, and get them approved before going live.
const TEMPLATES = {
  bookingReceived: {
    params: ['count', 'skill', 'site', 'date'],
    en: 'Labour Katta: Booking received for {{1}} × {{2}} at {{3}}, starting {{4}}. We are finding workers and will message you when the team is ready.',
    hi: 'लेबर कट्टा: {{3}} पर {{1}} × {{2}} की बुकिंग मिली, {{4}} से। हम मज़दूर ढूँढ रहे हैं, टीम तैयार होते ही मैसेज करेंगे।',
    mr: 'लेबर कट्टा: {{3}} येथे {{1}} × {{2}} ची बुकिंग मिळाली, {{4}} पासून. आम्ही कामगार शोधत आहोत, टीम तयार होताच मेसेज करू.',
  },
  teamReady: {
    params: ['count', 'skill', 'site', 'date'],
    en: 'Labour Katta: Your team is ready. {{1}} × {{2}} confirmed for {{3}}, starting {{4}}. Open the app to see names and call them.',
    hi: 'लेबर कट्टा: आपकी टीम तैयार है। {{3}} के लिए {{1}} × {{2}} पक्के, {{4}} से। नाम देखने और कॉल करने के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा: तुमची टीम तयार आहे. {{3}} साठी {{1}} × {{2}} पक्के, {{4}} पासून. नावे पाहण्यासाठी आणि कॉल करण्यासाठी ॲप उघडा.',
  },
  jobConfirmed: {
    params: ['skill', 'site', 'date', 'company', 'phone'],
    en: 'Labour Katta: Job confirmed. {{1}} at {{2}}, starting {{3}}. Contractor: {{4}} ({{5}}).',
    hi: 'लेबर कट्टा: काम पक्का। {{2}} पर {{1}}, {{3}} से। ठेकेदार: {{4}} ({{5}})।',
    mr: 'लेबर कट्टा: काम पक्के. {{2}} येथे {{1}}, {{3}} पासून. ठेकेदार: {{4}} ({{5}}).',
  },
  jobOffer: {
    params: ['skill', 'site', 'date', 'wage'],
    en: 'Labour Katta: New job for you. {{1}} at {{2}}, starting {{3}}. Pay {{4}} per day. Open the app to accept.',
    hi: 'लेबर कट्टा: आपके लिए नया काम। {{2}} पर {{1}}, {{3}} से। रोज़ {{4}}। स्वीकार करने के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा: तुमच्यासाठी नवीन काम. {{2}} येथे {{1}}, {{3}} पासून. दररोज {{4}}. स्वीकारण्यासाठी ॲप उघडा.',
  },
  replacement: {
    params: ['site'],
    en: 'Labour Katta: Replacement requested for {{1}}. We are assigning a new worker now.',
    hi: 'लेबर कट्टा: {{1}} के लिए दूसरे मज़दूर का अनुरोध मिला। हम नया मज़दूर तय कर रहे हैं।',
    mr: 'लेबर कट्टा: {{1}} साठी दुसऱ्या कामगाराची विनंती मिळाली. आम्ही नवीन कामगार ठरवत आहोत.',
  },
  planStarted: {
    params: ['amount'],
    en: 'Labour Katta: Your contractor plan is active. {{1}} per month by UPI AutoPay until you cancel. No job fee while the plan is active.',
    hi: 'लेबर कट्टा: आपका ठेकेदार प्लान चालू है। बंद करने तक UPI ऑटोपे से हर महीने {{1}}। प्लान चालू रहने तक कोई जॉब फ़ीस नहीं।',
    mr: 'लेबर कट्टा: तुमचा ठेकेदार प्लान सुरू आहे. बंद करेपर्यंत UPI ऑटोपेने दरमहा {{1}}. प्लान सुरू असेपर्यंत जॉब फी नाही.',
  },
  membershipStarted: {
    params: ['method'],
    en: 'Labour Katta: Your membership is active ({{1}}). You will now get job offers on WhatsApp and in the app.',
    hi: 'लेबर कट्टा: आपकी सदस्यता चालू है ({{1}})। अब आपको WhatsApp और ऐप पर काम के ऑफर मिलेंगे।',
    mr: 'लेबर कट्टा: तुमचे सदस्यत्व सुरू आहे ({{1}}). आता तुम्हाला WhatsApp आणि ॲपवर कामाच्या ऑफर मिळतील.',
  },
  workerAssigned: {
    params: ['name', 'skill', 'site', 'filled', 'total'],
    en: 'Labour Katta: {{1}} ({{2}}) is assigned to {{3}}. {{4}} of {{5}} places filled. Open the app to see the phone number.',
    hi: 'लेबर कट्टा: {{1}} ({{2}}) को {{3}} पर लगाया गया। {{5}} में से {{4}} जगह भरी। फ़ोन नंबर देखने के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा: {{1}} ({{2}}) यांना {{3}} येथे नेमले. {{5}} पैकी {{4}} जागा भरल्या. फोन नंबर पाहण्यासाठी ॲप उघडा.',
  },
  workerCheckin: {
    params: ['name', 'site', 'time'],
    en: 'Labour Katta: {{1}} has reached {{2}} at {{3}}. Please confirm attendance in the app.',
    hi: 'लेबर कट्टा: {{1}} {{3}} बजे {{2}} पहुँच गए। कृपया ऐप में हाज़िरी पक्की करें।',
    mr: 'लेबर कट्टा: {{1}} {{3}} वाजता {{2}} येथे पोहोचले. कृपया ॲपमध्ये हजेरी पक्की करा.',
  },
  workerCancelled: {
    params: ['name', 'site'],
    en: 'Labour Katta: {{1}} cannot come to {{2}}. We are offering the place to other workers now.',
    hi: 'लेबर कट्टा: {{1}} {{2}} नहीं आ पाएँगे। हम यह जगह अभी दूसरे मज़दूरों को दे रहे हैं।',
    mr: 'लेबर कट्टा: {{1}} {{2}} येथे येऊ शकत नाहीत. आम्ही ही जागा आता इतर कामगारांना देत आहोत.',
  },
  bookingCancelled: {
    params: ['site', 'date', 'company'],
    en: 'Labour Katta: The job at {{1}} starting {{2}} ({{3}}) is cancelled. Do not go to the site. New jobs will come on WhatsApp.',
    hi: 'लेबर कट्टा: {{1}} का काम, {{2}} से ({{3}}), रद्द हो गया है। साइट पर न जाएँ। नए काम WhatsApp पर आएँगे।',
    mr: 'लेबर कट्टा: {{1}} येथील काम, {{2}} पासून ({{3}}), रद्द झाले आहे. साइटवर जाऊ नका. नवीन कामे WhatsApp वर येतील.',
  },
  jobReminder: {
    params: ['site', 'date', 'time', 'address'],
    en: 'Labour Katta reminder: Work at {{1}} starts {{2}}. Please reach by {{3}}. Address: {{4}}. Open the app and tap "I will come" to confirm.',
    hi: 'लेबर कट्टा याद: {{1}} पर काम {{2}} से शुरू। कृपया {{3}} तक पहुँचें। पता: {{4}}। पक्का करने के लिए ऐप खोलकर "मैं आऊँगा" दबाएँ।',
    mr: 'लेबर कट्टा आठवण: {{1}} येथे काम {{2}} पासून सुरू. कृपया {{3}} पर्यंत पोहोचा. पत्ता: {{4}}. पक्के करण्यासाठी ॲप उघडून "मी येईन" दाबा.',
  },
  notConfirmed: {
    params: ['name', 'site', 'time'],
    en: 'Labour Katta: {{1}} has not confirmed for {{2}} (reporting {{3}}). Call them, or tap Replace in the app.',
    hi: 'लेबर कट्टा: {{1}} ने {{2}} ({{3}} बजे) के लिए पुष्टि नहीं की। उन्हें कॉल करें, या ऐप में बदलें दबाएँ।',
    mr: 'लेबर कट्टा: {{1}} यांनी {{2}} ({{3}} वाजता) साठी पुष्टी केली नाही. त्यांना कॉल करा, किंवा ॲपमध्ये बदला दाबा.',
  },
  siteNotice: {
    params: ['company', 'site', 'text'],
    en: 'Labour Katta – urgent from {{1}} ({{2}}): {{3}}',
    hi: 'लेबर कट्टा – {{1}} ({{2}}) से ज़रूरी सूचना: {{3}}',
    mr: 'लेबर कट्टा – {{1}} ({{2}}) कडून तातडीची सूचना: {{3}}',
  },
  wagesFinal: {
    params: ['site', 'days', 'amount'],
    en: 'Labour Katta: Wages finalised for {{1}}: {{2}} days, {{3}}. If this is wrong, open the app and report a payment problem.',
    hi: 'लेबर कट्टा: {{1}} की मज़दूरी तय: {{2}} दिन, {{3}}। गलत हो तो ऐप खोलकर भुगतान की शिकायत करें।',
    mr: 'लेबर कट्टा: {{1}} ची मजुरी निश्चित: {{2}} दिवस, {{3}}. चूक असल्यास ॲप उघडून पेमेंटची तक्रार करा.',
  },
  urgentReport: {
    params: ['category', 'from', 'text'],
    en: 'Labour Katta URGENT report ({{1}}) from {{2}}: {{3}}',
    hi: 'लेबर कट्टा ज़रूरी शिकायत ({{1}}) {{2}} से: {{3}}',
    mr: 'लेबर कट्टा तातडीची तक्रार ({{1}}) {{2}} कडून: {{3}}',
  },
  counterOffer: {
    params: ['name', 'skill', 'site', 'wage', 'travel'],
    en: 'Labour Katta: {{1}} ({{2}}) wants to work at {{3}} for {{4}} per day + {{5}} travel per day. Open the app to accept or decline.',
    hi: 'लेबर कट्टा: {{1}} ({{2}}) {{3}} पर रोज़ {{4}} + रोज़ {{5}} यात्रा खर्च पर काम करना चाहते हैं। स्वीकार या मना करने के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा: {{1}} ({{2}}) {{3}} येथे दररोज {{4}} + दररोज {{5}} प्रवास खर्चावर काम करू इच्छितात. स्वीकारण्यासाठी किंवा नाकारण्यासाठी ॲप उघडा.',
  },
  counterDeclined: {
    params: ['site', 'wage'],
    en: 'Labour Katta: The builder at {{1}} could not agree to more money. You can still take the job at {{2}} per day in the app.',
    hi: 'लेबर कट्टा: {{1}} के बिल्डर ज़्यादा पैसे पर राज़ी नहीं हुए। आप ऐप में रोज़ {{2}} पर अब भी काम ले सकते हैं।',
    mr: 'लेबर कट्टा: {{1}} चे बिल्डर जास्त पैशांवर तयार झाले नाहीत. तुम्ही ॲपमध्ये दररोज {{2}} वर अजूनही काम घेऊ शकता.',
  },
  autoReplaced: {
    params: ['old', 'new', 'site'],
    en: 'Labour Katta: {{1}} cannot come to {{3}}. {{2}} has been put on the job instead, at no extra cost to you. Open the app to see the phone number.',
    hi: 'लेबर कट्टा: {{1}} {{3}} नहीं आ पाएँगे। उनकी जगह {{2}} को लगाया गया है, आपको कोई अतिरिक्त ख़र्च नहीं। फ़ोन नंबर के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा: {{1}} {{3}} येथे येऊ शकत नाहीत. त्यांच्या जागी {{2}} यांना नेमले आहे, तुम्हाला कोणताही जादा खर्च नाही. फोन नंबरसाठी ॲप उघडा.',
  },
  newLead: {
    params: ['category', 'title', 'city', 'budget'],
    en: 'Labour Katta – new project for {{1}}: "{{2}}" in {{3}}. Budget: {{4}}. Open the app to send your quote.',
    hi: 'लेबर कट्टा – {{1}} के लिए नया प्रोजेक्ट: "{{2}}", {{3}} में। बजट: {{4}}। कोटेशन भेजने के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा – {{1}} साठी नवीन प्रकल्प: "{{2}}", {{3}} मध्ये. बजेट: {{4}}. कोटेशन पाठवण्यासाठी ॲप उघडा.',
  },
  quoteReceived: {
    params: ['company', 'title', 'amount'],
    en: 'Labour Katta: {{1}} sent a quote of {{3}} for "{{2}}". Open the app to compare quotes.',
    hi: 'लेबर कट्टा: {{1}} ने "{{2}}" के लिए {{3}} का कोटेशन भेजा। कोटेशन की तुलना के लिए ऐप खोलें।',
    mr: 'लेबर कट्टा: {{1}} यांनी "{{2}}" साठी {{3}} चे कोटेशन पाठवले. कोटेशनची तुलना करण्यासाठी ॲप उघडा.',
  },
  projectAwarded: {
    params: ['title', 'client', 'phone'],
    en: 'Labour Katta: Congratulations! You have been awarded "{{1}}" by {{2}}. Client phone: {{3}}. A Labour Katta inspector will check the work.',
    hi: 'लेबर कट्टा: बधाई! {{2}} ने आपको "{{1}}" का काम दिया है। ग्राहक का फ़ोन: {{3}}। लेबर कट्टा निरीक्षक काम की जाँच करेंगे।',
    mr: 'लेबर कट्टा: अभिनंदन! {{2}} यांनी तुम्हाला "{{1}}" चे काम दिले आहे. ग्राहकाचा फोन: {{3}}. लेबर कट्टा निरीक्षक कामाची तपासणी करतील.',
  },
  inspectionResult: {
    params: ['title', 'result', 'notes'],
    en: 'Labour Katta inspection for "{{1}}": {{2}}. Notes: {{3}}',
    hi: 'लेबर कट्टा निरीक्षण, "{{1}}": {{2}}। टिप्पणी: {{3}}',
    mr: 'लेबर कट्टा तपासणी, "{{1}}": {{2}}. टिप्पणी: {{3}}',
  },
  paymentIssue: {
    params: ['worker', 'site'],
    en: 'Labour Katta admin: {{1}} reported NOT receiving direct payment for {{2}}. Please call the contractor.',
    hi: 'लेबर कट्टा एडमिन: {{1}} ने {{2}} का सीधा भुगतान नहीं मिलने की शिकायत की। कृपया ठेकेदार को कॉल करें।',
    mr: 'लेबर कट्टा ॲडमिन: {{1}} यांनी {{2}} चे थेट पेमेंट न मिळाल्याची तक्रार केली. कृपया ठेकेदाराला कॉल करा.',
  },
};

function render(templateKey, lang, values) {
  const tpl = TEMPLATES[templateKey];
  const text = tpl[lang] || tpl.en;
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => String(values[Number(n) - 1] ?? ''));
}
function orderedParams(templateKey, params) {
  return TEMPLATES[templateKey].params.map(k => String(params[k] ?? ''));
}

module.exports = { TEMPLATES, render, orderedParams };
