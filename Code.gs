/**
 * BizPulse Customers & Referrals — Google Apps Script web app for https://mybizpulse.in/download.html
 * Srijee Creations · issues BizPulse licence keys, logs customers and referrals, emails each customer,
 * backs the sheet up daily and sends trial-expiry and renewal reminders.
 *
 * SET-UP (once)
 *   1. Create a Google Sheet named "BizPulse Customers & Referrals".
 *   2. In that sheet: Extensions › Apps Script. Replace everything in Code.gs with this file and save.
 *   3. Deploy › New deployment › type "Web app":
 *        Execute as: Me        Who has access: Anyone
 *      Approve the permissions (Sheets, sending email).
 *   4. Copy the Web app URL (https://script.google.com/macros/s/…/exec) into download.html:
 *        const LICENSE_API_URL = '…/exec';
 *   5. After any later edit to this script: Deploy › Manage deployments › Edit › Version: New version › Deploy
 *      (the /exec URL stays the same).
 *   6. Project Settings (gear icon) › Time zone: (GMT+05:30) India Standard Time, so "6 PM" is 6 PM in India.
 *   7. Reload the sheet: a "BizPulse Admin" menu appears. Run "Turn On Daily 6 PM Backup & Reminders" once (approve Drive
 *      access). Every day at about 6 PM the whole spreadsheet is emailed as .xlsx to BACKUP_EMAIL, and the trial-expiry and
 *      renewal reminders go out. If you turned on the older "Daily 6 PM Backup", run this item once: it replaces it.
 *
 * MODES AND PLANS
 *   The page sends mode (TRIAL or PAID), plan and edition.
 *   • TRIAL — plans TVX (Voice Express, 7 days), TBILL (Billing, 7 days), TLITE (Lite, 7 days), TSTD (Standard, 15 days),
 *     TPRO (Pro, 21 days).
 *     The trial key is issued at once, shown on the page and emailed with the referral code.
 *   • PAID  — plans VX (BizPulse Pocket · Voice Express), BILL, LITE, STD_SILVER / GOLD / PLATINUM, PRO_SILVER / GOLD / PLATINUM. The order is recorded as
 *     "Payment Pending · Trial Key Issued" and a temporary trial key of the same edition (VX→TVX, BILL→TBILL, LITE→TLITE,
 *     STD→TSTD, PRO→TPRO) is issued at once. When payment arrives, select the row and run
 *     BizPulse Admin › Approve Selected Row & Issue Paid Key: the permanent key and the referral code are emailed, and the
 *     referral (if any) becomes Payable. In BizPulse the customer enters the new key in Settings › License & Device;
 *     the desktop app replaces the activation in place and keeps every company and voucher.
 *
 * LICENCE KEYS
 *   Keys are made exactly the way the BizPulse desktop app checks them (src/server/services/editionActivation.ts):
 *     BP-<EDITION>-<XXXXX>-<XXXXX>-<CHECK>
 *   CHECK = the first 5 bytes of HMAC-SHA256(ISSUER_SECRET, "<EDITION>|<email in lower case>|<XXXXX-XXXXX>"), each byte
 *   mapped to KEY_CHARS[byte % 32]. A key therefore activates only with the email it was issued for.
 *   ISSUER_SECRET and KEY_CHARS below must stay identical to the app's; if one changes, change both.
 *   Keep this script private: anyone who reads ISSUER_SECRET can make keys.
 *
 * EXPIRY DATES IN THE SHEET
 *   The desktop app counts a key's days from the day it is activated on the PC. This script cannot see that day, so
 *   "Key Expires On" is an estimate: trials from the registration date, paid keys from the approval date. Reminders use it.
 */

// ─── Settings ───────────────────────────────────────────────────────────────────────────────────────────────
/** Leave empty when this script is opened from the sheet (Extensions › Apps Script). Otherwise paste the sheet ID. */
const SPREADSHEET_ID = '';
/** Must match the BizPulse desktop app exactly. */
const ISSUER_SECRET = 'bizpulse/srijee-creations/edition-key/v1';
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** The GitHub Release that holds the five Windows installers, one ZIP per edition (extract it and run Setup.exe). */
const RELEASE_BASE = 'https://github.com/dinlac-rgb/dinlac-rgb.github.io/releases/download/v1.0.0/';
/** The installer of each edition. Trial and paid keys of an edition use the same installer; CA and TRIAL use Pro's. */
const INSTALLERS = {
  VX: 'BizPulse_Voice_Express_Setup_v1.0.0.zip',
  BILL: 'BizPulse_Billing_Setup_v1.0.0.zip',
  LITE: 'BizPulse_Lite_Setup_v1.0.0.zip',
  STD: 'BizPulse_Standard_Setup_v1.0.0.zip',
  PRO: 'BizPulse_Setup_v1.0.0.zip',
  CA: 'BizPulse_Setup_v1.0.0.zip',
};
/** The Pro installer (older links and anything without an edition). */
const DOWNLOAD_URL = RELEASE_BASE + INSTALLERS.PRO;
const SITE_URL = 'https://mybizpulse.in/download.html';
const PRICING_URL = 'https://mybizpulse.in/pricing.html';
const SENDER_NAME = 'BizPulse · Srijee Creations';

/** The installer for a key code: TVX / VX → Voice Express, TBILL / BILL → Billing, TLITE / LITE → Lite, TSTD / STD → Standard, TPRO / PRO / TRIAL / CA → Pro. */
function downloadUrlFor_(code) {
  const family = FEATURE_EDITION[String(code || '').toUpperCase()] || 'PRO';
  return RELEASE_BASE + (INSTALLERS[family] || INSTALLERS.PRO);
}
/** The installer ZIP's file name, for the emails. */
function installerName_(code) {
  return downloadUrlFor_(code).slice(RELEASE_BASE.length);
}
/** WhatsApp number customers can reply to (shown in reminder emails). Country code + number, digits only; '' to leave out. */
const SUPPORT_WHATSAPP = '';
/** The daily backup (.xlsx of the whole spreadsheet) goes here. */
const BACKUP_EMAIL = 'dinesh.srijeecreations@gmail.com';
/** Hour of the daily backup and reminders in the script's time zone (set it to India in Project Settings). */
const BACKUP_HOUR = 18;
/** Licence dates are India dates, like the desktop app. */
const LICENCE_TZ = 'Asia/Kolkata';
/**
 * Trial reminder window: a trial (or temporary) key gets one reminder when it has this many hours or fewer left
 * (counted to the end of its last day, India time). The daily run is at about 6 PM, so with 36 the reminder goes out on the
 * evening before the last day (about 30 hours left). An hourly run is not needed.
 */
const TRIAL_REMINDER_HOURS = 36;
/** Paid renewal reminders: days before the yearly expiry. */
const RENEWAL_REMINDER_DAYS = [30, 3];

/** Every plan on mybizpulse.in: mode, the desktop edition code its key is made for, and its full name. */
const PLANS = {
  // Free trials
  TVX: { mode: 'TRIAL', code: 'TVX', days: 7, name: 'BizPulse Voice Express — 7-Day Free Trial' },
  TBILL: { mode: 'TRIAL', code: 'TBILL', days: 7, name: 'BizPulse Billing — 7-Day Free Trial' },
  TLITE: { mode: 'TRIAL', code: 'TLITE', days: 7, name: 'BizPulse Lite — 7-Day Free Trial' },
  TSTD: { mode: 'TRIAL', code: 'TSTD', days: 15, name: 'BizPulse Standard — 15-Day Free Trial' },
  TPRO: { mode: 'TRIAL', code: 'TPRO', days: 21, name: 'BizPulse Pro — 21-Day Free Trial' },
  /** The original 7-day full-Pro trial (older links). */
  TRIAL: { mode: 'TRIAL', code: 'TRIAL', days: 7, name: '7-Day Free Trial (Full BizPulse Pro)' },
  // Paid subscriptions (trial = the temporary key issued while payment is pending)
  VX: { mode: 'PAID', code: 'VX', trial: 'TVX', term: 'YEAR', name: 'BizPulse Pocket (Voice Express)' },
  BILL: { mode: 'PAID', code: 'BILL', trial: 'TBILL', term: 'YEAR', name: 'BizPulse Billing' },
  LITE: { mode: 'PAID', code: 'LITE', trial: 'TLITE', term: 'YEAR', name: 'BizPulse Lite' },
  STD_SILVER: { mode: 'PAID', code: 'STD', trial: 'TSTD', term: 'YEAR', name: 'BizPulse Standard Silver' },
  STD_GOLD: { mode: 'PAID', code: 'STD', trial: 'TSTD', term: 'YEAR', name: 'BizPulse Standard Gold' },
  STD_PLATINUM: { mode: 'PAID', code: 'STD', trial: 'TSTD', term: 'LIFETIME', name: 'BizPulse Standard Platinum (Lifetime)' },
  PRO_SILVER: { mode: 'PAID', code: 'PRO', trial: 'TPRO', term: 'YEAR', name: 'BizPulse Pro Silver' },
  PRO_GOLD: { mode: 'PAID', code: 'PRO', trial: 'TPRO', term: 'YEAR', name: 'BizPulse Pro Gold' },
  PRO_PLATINUM: { mode: 'PAID', code: 'PRO', trial: 'TPRO', term: 'LIFETIME', name: 'BizPulse Pro Platinum (Lifetime)' },
};
/** A bare edition (older links: ?edition=STD) is recorded as that edition's default plan. */
const EDITION_DEFAULT_PLAN = { TRIAL: 'TRIAL', TVX: 'TVX', VX: 'VX', TBILL: 'TBILL', TLITE: 'TLITE', TSTD: 'TSTD', TPRO: 'TPRO', BILL: 'BILL', LITE: 'LITE', STD: 'STD_SILVER', PRO: 'PRO_SILVER' };

/** Every code the desktop app accepts, with its name. */
const EDITIONS = {
  TRIAL: 'BizPulse Trial (7 days, full Pro)',
  TVX: 'BizPulse Voice Express Trial (7 days)',
  TBILL: 'BizPulse Billing Trial (7 days)',
  TLITE: 'BizPulse Lite Trial (7 days)',
  TSTD: 'BizPulse Standard Trial (15 days)',
  TPRO: 'BizPulse Pro Trial (21 days)',
  VX: 'BizPulse Voice Express',
  BILL: 'BizPulse Billing',
  LITE: 'BizPulse Lite',
  STD: 'BizPulse Standard',
  PRO: 'BizPulse Pro Corporate',
  CA: 'CA Master License',
};
/** Days of each trial code (the desktop app counts them from activation, the first day included). */
const TRIAL_DAYS = { TRIAL: 7, TVX: 7, TBILL: 7, TLITE: 7, TSTD: 15, TPRO: 21 };
/** The edition whose features a code unlocks. */
const FEATURE_EDITION = { TRIAL: 'PRO', TVX: 'VX', VX: 'VX', TBILL: 'BILL', TLITE: 'LITE', TSTD: 'STD', TPRO: 'PRO', BILL: 'BILL', LITE: 'LITE', STD: 'STD', PRO: 'PRO', CA: 'CA' };
/** What each edition includes (for the emails). Matches the desktop app's edition gating. */
const FEATURES = {
  VX: [
    'Voice billing on your Android phone (BizPulse Pocket): speak the sale, the bill is made for you',
    'GST sales invoices, synced to BizPulse on your Windows PC over your own Wi-Fi',
    'Customers, items and sales registers on the PC',
  ],
  BILL: [
    'GST sales and purchase invoices with e-invoice-ready layouts',
    'Receipts and payments, customer and supplier ledgers',
    'Outstanding, sales and purchase registers',
  ],
  LITE: [
    'Everything in Billing',
    'Full double-entry accounting: all vouchers, Day Book, Trial Balance, Profit & Loss and Balance Sheet',
    'Inventory: stock items, godowns and stock reports',
  ],
  STD: [
    'Everything in Lite',
    'GST returns (GSTR-1, GSTR-3B) and reconciliation reports',
    'TDS / TCS and the statutory reports',
  ],
  PRO: [
    'Everything in Standard',
    'Bank automation and reconciliation',
    'Every advanced report and feature in BizPulse',
  ],
  CA: [
    'Every BizPulse feature, for a CA practice handling client companies',
  ],
};

// New columns are added at the end, so sheets made by an earlier version keep every existing column where it was.
const CUSTOMER_HEADERS = ['Timestamp', 'Full Name', 'Business Name', 'Email (BizPulse ID)', 'WhatsApp Mobile', 'State', 'Edition', 'License Key', 'My Referral Code', 'Referred By Code', 'Status', 'Source', 'Plan',
  'Mode', 'Key Expires On', 'WhatsApp Link', 'Reminders Sent', 'Temporary Key', 'Approved On'];
const REFERRAL_HEADERS = ['Timestamp', 'Referrer Code', 'Referrer Email', 'Referee Name', 'Referee Email', 'Edition', 'Cashback Rate', 'Status', 'Plan'];
const ISSUED_HEADERS = ['Timestamp', 'Email (BizPulse ID)', 'Edition', 'License Key', 'Key Expires On', 'Issued By', 'Note'];
const C = { ts: 0, name: 1, business: 2, email: 3, mobile: 4, state: 5, edition: 6, key: 7, myRef: 8, refBy: 9, status: 10, source: 11, plan: 12,
  mode: 13, expires: 14, wa: 15, reminders: 16, tempKey: 17, approved: 18 };
const R = { ts: 0, code: 1, refEmail: 2, name: 3, email: 4, edition: 5, rate: 6, status: 7, plan: 8 };

const STATUS = {
  TRIAL: 'Trial',
  PENDING: 'Payment Pending · Trial Key Issued',
  PAID: 'Paid · Key Issued',
};

// ─── Web app ────────────────────────────────────────────────────────────────────────────────────────────────
function doGet() {
  return json_({ ok: true, service: 'BizPulse Customers & Referrals', time: new Date().toISOString() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'The server is busy. Please try again in a moment.' });
  }
  try {
    const req = parseRequest_(e);
    const result = register_(req);
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// ─── Registration ───────────────────────────────────────────────────────────────────────────────────────────
function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('No form data was received.');
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { throw new Error('The form data could not be read.'); }
  const req = {
    fullName: clean_(body.fullName, 80),
    businessName: clean_(body.businessName, 120),
    email: clean_(body.email, 120).toLowerCase(),
    mobile: String(body.mobile || '').replace(/\D/g, '').slice(-10),
    state: clean_(body.state, 60),
    edition: clean_(body.edition, 10).toUpperCase(),
    plan: clean_(body.plan || body.planName, 40).toUpperCase().replace(/[\s-]+/g, '_'),
    mode: clean_(body.mode, 10).toUpperCase(),
    referralCode: clean_(body.referralCode, 20).toUpperCase(),
    source: clean_(body.source, 120) || 'mybizpulse.in',
  };
  if (req.fullName.length < 2) throw new Error('Please enter your full name.');
  if (!isEmail_(req.email)) throw new Error('Please enter a valid email.');
  if (!/^[6-9]\d{9}$/.test(req.mobile)) throw new Error('Please enter a valid 10-digit WhatsApp number.');
  if (!req.state) throw new Error('Please choose your state.');
  // The plan decides the desktop edition code; a request with only an edition gets that edition's default plan.
  if (!has_(PLANS, req.plan)) req.plan = has_(EDITION_DEFAULT_PLAN, req.edition) ? EDITION_DEFAULT_PLAN[req.edition] : '';
  if (!req.plan) throw new Error('Please choose an edition.');
  if (req.mode !== 'TRIAL' && req.mode !== 'PAID') req.mode = PLANS[req.plan].mode;
  // "Use it for Free" with a paid plan chosen: give that edition's free trial.
  if (req.mode === 'TRIAL' && PLANS[req.plan].mode === 'PAID') req.plan = PLANS[req.plan].trial;
  if (req.mode === 'PAID' && PLANS[req.plan].mode === 'TRIAL') throw new Error('Please choose a paid plan, or choose "Use it for Free (Trial)".');
  req.edition = PLANS[req.plan].code;
  req.planName = PLANS[req.plan].name;
  return req;
}

function register_(req) {
  const ss = spreadsheet_();
  const customers = sheet_(ss, 'Customers', CUSTOMER_HEADERS);
  const referrals = sheet_(ss, 'Referrals', REFERRAL_HEADERS);
  const rows = customerRows_(customers);
  const plan = PLANS[req.plan];

  // Same email + plan already registered (rows from before plans existed: same email + edition): return the same key and
  // referral code (no duplicate row, no new email).
  const existing = rows.find((r) => String(r[C.email]).toLowerCase() === req.email && (String(r[C.plan] || '').toUpperCase() ? String(r[C.plan]).toUpperCase() === req.plan : String(r[C.edition]).toUpperCase() === req.edition));
  if (existing) return response_(req, existing, true);

  // A customer keeps one referral code across editions.
  const sameEmail = rows.find((r) => String(r[C.email]).toLowerCase() === req.email && r[C.myRef]);
  const taken = new Set(rows.map((r) => String(r[C.myRef]).toUpperCase()));
  const myReferralCode = sameEmail ? String(sameEmail[C.myRef]) : newReferralCode_(taken);

  const today = todayIso_();
  let licenseKey, status, expiresOn, keyCode;
  if (req.mode === 'TRIAL') {
    keyCode = plan.code;
    licenseKey = generateLicenseKey(keyCode, req.email);
    status = STATUS.TRIAL;
    expiresOn = addDaysIso_(today, TRIAL_DAYS[keyCode] - 1);
  } else {
    // Paid order: a temporary trial key of the same edition until payment is confirmed. If this email already has that
    // free trial, the same trial key is reused (BizPulse allows each trial once per PC, so a second trial key of the same
    // edition would be refused on that PC; the trial already running there simply continues).
    keyCode = plan.trial;
    const earlierTrial = rows.find((r) => String(r[C.email]).toLowerCase() === req.email && String(r[C.edition]).toUpperCase() === keyCode && /^BP-/.test(String(r[C.key])));
    licenseKey = earlierTrial ? String(earlierTrial[C.key]) : generateLicenseKey(keyCode, req.email);
    expiresOn = earlierTrial ? isoOf_(earlierTrial[C.expires]) || addDaysIso_(today, TRIAL_DAYS[keyCode] - 1) : addDaysIso_(today, TRIAL_DAYS[keyCode] - 1);
    status = STATUS.PENDING;
  }

  // Referral: a known code that is not the customer's own. Cashback is earned on payment, so a paid order waits for
  // approval and a free trial stays "Trial" until that customer buys.
  let refBy = '';
  if (req.referralCode) {
    const referrer = rows.find((r) => String(r[C.myRef]).toUpperCase() === req.referralCode);
    if (referrer && String(referrer[C.email]).toLowerCase() !== req.email) {
      refBy = req.referralCode;
      const now = new Date();
      const earlier = referrals.getLastRow() > 1 ? referrals.getRange(2, 2, referrals.getLastRow() - 1, 1).getValues().filter((v) => String(v[0]).toUpperCase() === refBy).length : 0;
      const referrerSince = firstRegistration_(rows, String(referrer[C.email]).toLowerCase());
      const within30 = referrerSince && now.getTime() - referrerSince.getTime() <= 30 * 86400000;
      const rate = earlier === 0 && within30 ? '15%' : '10%';
      referrals.appendRow([now, refBy, String(referrer[C.email]), safe_(req.fullName), req.email, req.edition, rate, req.mode === 'PAID' ? 'Awaiting Payment' : 'Trial · Not Yet Payable', req.planName]);
    }
  }

  const row = [new Date(), safe_(req.fullName), safe_(req.businessName), req.email, "'" + req.mobile, safe_(req.state), req.edition, licenseKey, myReferralCode, refBy, status, safe_(req.source), req.plan,
    req.mode, expiresOn, '', '', req.mode === 'PAID' ? licenseKey : '', ''];
  row[C.wa] = customerWhatsappLink_(req.fullName, req.mobile, req.mode === 'PAID'
    ? 'thank you for ordering ' + req.planName + '. Your temporary BizPulse key is ' + licenseKey + ' (registered email ' + req.email + '). Download: ' + downloadUrlFor_(keyCode) + ' — we will send your permanent key once payment is confirmed.'
    : 'thank you for trying ' + req.planName + '. Your BizPulse key is ' + licenseKey + ' (registered email ' + req.email + '). Download: ' + downloadUrlFor_(keyCode));
  customers.appendRow(row);

  sendThankYou_(req, licenseKey, myReferralCode, keyCode, expiresOn);
  return response_(req, row, false);
}

/** What the page receives. A paid order's referral code is released with the permanent key. */
function response_(req, row, existing) {
  const key = String(row[C.key]);
  const keyCode = keyCodeOf_(key) || String(row[C.edition]).toUpperCase();
  const trialKey = has_(TRIAL_DAYS, keyCode);
  const status = String(row[C.status] || '');
  const pending = status.indexOf('Payment Pending') === 0 && trialKey;
  const ref = String(row[C.myRef] || '');
  const out = {
    ok: true,
    mode: String(row[C.mode] || req.mode),
    status: pending ? 'PENDING_PAYMENT' : 'ACTIVE',
    keyType: trialKey ? 'TRIAL' : 'PAID',
    licenseKey: key,
    expiresOn: isoOf_(row[C.expires]),
    editionName: req.planName,
    planName: req.planName,
    plan: req.plan,
    // The installer of the registered edition (a paid order's temporary key is of the same edition: STD → TSTD).
    downloadUrl: downloadUrlFor_(keyCode),
  };
  if (trialKey) out.trialDays = TRIAL_DAYS[keyCode];
  if (!pending && ref) { out.myReferralCode = ref; out.whatsappShareUrl = whatsappUrl_(ref); }
  if (existing) out.existing = true;
  return out;
}

// ─── Licence key (identical to the BizPulse desktop app) ────────────────────────────────────────────────────
/** BP-<CODE>-<XXXXX>-<XXXXX>-<CHECK>, bound to the email. */
function generateLicenseKey(code, email) {
  if (!Object.prototype.hasOwnProperty.call(EDITIONS, code)) throw new Error('Unknown edition ' + code);
  const serial = randomBlock_() + '-' + randomBlock_();
  return 'BP-' + code + '-' + serial + '-' + checkBlock_(code, email, serial);
}

function checkBlock_(code, email, serial) {
  const message = code + '|' + String(email).trim().toLowerCase() + '|' + serial;
  const bytes = Utilities.computeHmacSha256Signature(message, ISSUER_SECRET, Utilities.Charset.UTF_8);
  let out = '';
  for (let i = 0; i < 5; i++) out += KEY_CHARS.charAt(((bytes[i] % 256) + 256) % 256 % KEY_CHARS.length); // Apps Script bytes are signed
  return out;
}

function randomBlock_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + ':' + Math.random() + ':' + Date.now());
  let out = '';
  for (let i = 0; i < 5; i++) out += KEY_CHARS.charAt(((bytes[i] % 256) + 256) % 256 % KEY_CHARS.length);
  return out;
}

/** The edition code inside a key: BP-TSTD-… → TSTD. */
function keyCodeOf_(key) {
  const m = /^BP-([A-Z]+)-/.exec(String(key || ''));
  return m && has_(EDITIONS, m[1]) ? m[1] : '';
}

/** Run from the editor to see a key and its check: testKey(). */
function testKey() {
  ['VX', 'TVX', 'BILL', 'TBILL', 'TSTD', 'TPRO'].forEach((code) => {
    const k = generateLicenseKey(code, 'owner@example.in');
    const p = k.split('-');
    Logger.log(k + '  check ok: ' + (checkBlock_(code, 'owner@example.in', p[2] + '-' + p[3]) === p[4]));
  });
}

// ─── Emails ─────────────────────────────────────────────────────────────────────────────────────────────────
function featureLines_(code) {
  return (FEATURES[FEATURE_EDITION[code] || 'PRO'] || []).map((f) => '  • ' + f);
}

function referralLines_(code) {
  return [
    'Your Referral Code: ' + code,
    'Refer & earn: share your referral code. When someone you refer buys BizPulse, you earn 15% cashback on your first referral within 30 days, and 10% cashback on every referral after that.',
  ];
}

function installLines_(code) {
  return [
    'Install in 3 easy steps:',
    '  1. Download the ZIP (' + installerName_(code) + '): ' + downloadUrlFor_(code),
    '  2. Extract the ZIP: right-click it › Extract All… › Extract.',
    '  3. Run Setup.exe from the extracted folder. If a blue "Windows protected your PC" box appears, click More info › Run anyway.',
    'It is safe: the ZIP comes straight from our official GitHub release. (If Microsoft Edge still asks about the download, click "…" › Keep.)',
    '',
    'On first launch, enter the registered email and the licence key above, then press Activate.',
  ];
}

function mail_(to, subject, lines) {
  const body = lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  try {
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: SENDER_NAME });
    return true;
  } catch (err) {
    // The key is still returned on screen and saved in the sheet; a daily email quota or a bad address must not lose it.
    console.error('Email to ' + to + ' failed: ' + err);
    return false;
  }
}

/** The Thank-You email sent on registration (free trial or paid order). */
function sendThankYou_(req, licenseKey, myReferralCode, keyCode, expiresOn) {
  const first = req.fullName.split(/\s+/)[0];
  const pending = req.mode === 'PAID';
  const lines = [
    'Dear ' + first + ',',
    '',
    pending
      ? 'Thank you for ordering ' + req.planName + (req.businessName ? ' for ' + req.businessName : '') + '. Your order is recorded and awaiting payment.'
      : 'Thank you for choosing BizPulse' + (req.businessName ? ' for ' + req.businessName : '') + '. Your free trial key is ready.',
    '',
    'Registered Email (BizPulse ID): ' + req.email,
    (pending ? 'Plan ordered: ' : 'Trial: ') + req.planName,
    (pending ? 'Temporary Key: ' : 'Licence Key: ') + licenseKey,
    'Valid for ' + TRIAL_DAYS[keyCode] + ' days from activation (about ' + niceDate_(expiresOn) + ' if you activate today).',
    '',
    'What ' + EDITIONS[FEATURE_EDITION[keyCode]] + ' includes:',
  ].concat(featureLines_(keyCode), [''], installLines_(keyCode), ['']);
  if (pending) {
    lines.push('As soon as we confirm your payment, we will email your permanent ' + req.planName + ' licence key and your referral code. Enter the permanent key in BizPulse › Settings › License & Device: your companies and vouchers stay exactly as they are.');
  } else {
    lines.push.apply(lines, referralLines_(myReferralCode));
    lines.push('', 'Like it? Buy a plan any time at ' + PRICING_URL + ' and enter the new key in Settings › License & Device. Everything you entered during the trial is kept.');
  }
  lines.push('', 'Support: 10 AM – 6 PM, Monday to Saturday.', '— Srijee Creations');
  return mail_(req.email, (pending ? 'Your BizPulse order and temporary key — ' : 'Your BizPulse free trial key — ') + req.planName, lines);
}

/** Sent on approval: the permanent key, features and the referral code. */
function sendPaidKey_(row, paidKey, expiresOn) {
  const plan = planOfRow_(row);
  const code = keyCodeOf_(paidKey);
  const lines = [
    'Dear ' + String(row[C.name]).split(/\s+/)[0] + ',',
    '',
    'Thank you! Your payment for ' + plan.name + ' is confirmed.',
    '',
    'Registered Email (BizPulse ID): ' + String(row[C.email]),
    'Plan: ' + plan.name,
    'Permanent Licence Key: ' + paidKey,
    expiresOn === 'Lifetime' ? 'Validity: Lifetime' : 'Valid for one year from activation (about ' + niceDate_(expiresOn) + ' if you activate today).',
    '',
    'How to switch from your temporary key: open BizPulse › Settings › License & Device, enter this key with the same email and press Activate. The licence is replaced in place; every company, voucher and setting stays as it is.',
    '',
    'What ' + EDITIONS[code] + ' includes:',
  ].concat(featureLines_(code), [''], referralLines_(String(row[C.myRef])), ['', 'Download (if you need to reinstall): ' + downloadUrlFor_(code), '', 'Support: 10 AM – 6 PM, Monday to Saturday.', '— Srijee Creations']);
  return mail_(String(row[C.email]), 'Your BizPulse licence key — ' + plan.name, lines);
}

// ─── After payment ──────────────────────────────────────────────────────────────────────────────────────────
/** Select a row in Customers whose Status is "Payment Pending · Trial Key Issued", then run this to issue and email the paid key. */
function issuePaidKeyForRow() {
  const ss = spreadsheet_();
  const sh = sheet_(ss, 'Customers', CUSTOMER_HEADERS);
  const range = ss.getActiveSheet && ss.getActiveSheet().getName() === 'Customers' ? ss.getActiveSheet().getActiveRange() : sh.getActiveRange();
  const rowNo = range.getRow();
  if (rowNo < 2) throw new Error('Select a customer row in the Customers sheet first.');
  const v = sh.getRange(rowNo, 1, 1, CUSTOMER_HEADERS.length).getValues()[0];
  const plan = planOfRow_(v);
  const code = plan.code;
  if (has_(TRIAL_DAYS, code)) throw new Error('This row is a free trial, not a paid order. To give this customer a paid key anyway, use Generate Custom Free Key….');
  if (String(v[C.status]).indexOf('Paid') === 0) throw new Error('This row is already approved (' + v[C.status] + ').');

  const email = String(v[C.email]).toLowerCase();
  const key = generateLicenseKey(code, email);
  const today = todayIso_();
  const expiresOn = plan.term === 'LIFETIME' ? 'Lifetime' : addDaysIso_(addYearsIso_(today, 1), -1);
  const oldKey = String(v[C.key]);

  set_(sh, rowNo, C.tempKey, v[C.tempKey] || (keyCodeOf_(oldKey) && has_(TRIAL_DAYS, keyCodeOf_(oldKey)) ? oldKey : ''));
  set_(sh, rowNo, C.key, key);
  set_(sh, rowNo, C.status, STATUS.PAID);
  set_(sh, rowNo, C.mode, 'PAID');
  set_(sh, rowNo, C.expires, expiresOn);
  set_(sh, rowNo, C.approved, today);
  set_(sh, rowNo, C.reminders, '');
  set_(sh, rowNo, C.wa, customerWhatsappLink_(String(v[C.name]), digits_(v[C.mobile]), 'your payment for ' + plan.name + ' is confirmed. Your permanent BizPulse key is ' + key + ' (registered email ' + email + '). Enter it in Settings › License & Device; your data stays as it is. Installer: ' + downloadUrlFor_(code)));
  if (!v[C.plan]) set_(sh, rowNo, C.plan, planCodeOf_(v));

  // The referral for this purchase becomes payable.
  const refs = ss.getSheetByName('Referrals');
  let payable = 0;
  if (refs && refs.getLastRow() > 1) {
    const rr = refs.getRange(2, 1, refs.getLastRow() - 1, REFERRAL_HEADERS.length).getValues();
    rr.forEach((r, i) => {
      if (String(r[R.email]).toLowerCase() === email && String(r[R.status]).indexOf('Payable') !== 0 && (!r[R.plan] || String(r[R.plan]) === plan.name)) {
        refs.getRange(i + 2, R.status + 1).setValue('Payable');
        payable++;
      }
    });
  }

  const after = sh.getRange(rowNo, 1, 1, CUSTOMER_HEADERS.length).getValues()[0];
  const sent = sendPaidKey_(after, key, expiresOn);
  toast_('Paid key issued' + (sent ? ' and emailed to ' + email : ' (the email could not be sent — copy the key from the sheet)') + (payable ? '; referral marked Payable.' : '.'));
}

// ─── Custom free key ────────────────────────────────────────────────────────────────────────────────────────
/** BizPulse Admin › Generate Custom Free Key…: an HMAC-signed key for any email and any edition, logged in "Issued Keys". */
function generateCustomFreeKey() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('Generate Custom Free Key', 'Customer email (the key works only with this email):', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const email = clean_(a.getResponseText(), 120).toLowerCase();
  if (!isEmail_(email)) { ui.alert('That is not a valid email. Nothing was issued.'); return; }
  const codes = Object.keys(EDITIONS);
  const b = ui.prompt('Generate Custom Free Key', 'Edition code for ' + email + ':\n' + codes.map((c) => c + ' — ' + EDITIONS[c]).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  const code = clean_(b.getResponseText(), 10).toUpperCase();
  if (!has_(EDITIONS, code)) { ui.alert('Unknown edition code "' + code + '". Use one of: ' + codes.join(', ') + '. Nothing was issued.'); return; }

  const key = generateLicenseKey(code, email);
  const today = todayIso_();
  const expiresOn = has_(TRIAL_DAYS, code) ? addDaysIso_(today, TRIAL_DAYS[code] - 1) : addDaysIso_(addYearsIso_(today, 1), -1);
  let by = '';
  try { by = Session.getActiveUser().getEmail(); } catch (err) { /* not available to every account */ }
  const log = sheet_(spreadsheet_(), 'Issued Keys', ISSUED_HEADERS);
  log.appendRow([new Date(), email, code, key, expiresOn, by, 'Custom free key']);

  const send = ui.alert('Key for ' + email + ' (' + EDITIONS[code] + '):\n\n' + key + '\n\nValid ' + (has_(TRIAL_DAYS, code) ? TRIAL_DAYS[code] + ' days' : 'one year') + ' from activation. It is saved in the "Issued Keys" sheet.\n\nEmail this key to ' + email + ' now?', ui.ButtonSet.YES_NO);
  if (send === ui.Button.YES) {
    const ok = mail_(email, 'Your BizPulse licence key — ' + EDITIONS[code], [
      'Hello,', '', 'Here is your complimentary BizPulse licence key from Srijee Creations.', '',
      'Registered Email (BizPulse ID): ' + email, 'Edition: ' + EDITIONS[code], 'Licence Key: ' + key, '',
      'What it includes:',
    ].concat(featureLines_(code), [''], installLines_(code), ['If BizPulse is already installed, enter it in Settings › License & Device; your data stays as it is.', '', 'Support: 10 AM – 6 PM, Monday to Saturday.', '— Srijee Creations']));
    log.getRange(log.getLastRow(), 7).setValue(ok ? 'Custom free key · emailed' : 'Custom free key · email failed');
    toast_(ok ? 'Key emailed to ' + email + '.' : 'The email could not be sent; the key is in "Issued Keys".');
  }
}

// ─── BizPulse Admin menu ────────────────────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BizPulse Admin')
    .addItem('Approve Selected Row & Issue Paid Key', 'issuePaidKeyForRow')
    .addItem('Generate Custom Free Key…', 'generateCustomFreeKey')
    .addSeparator()
    .addItem('Send Daily Backup Email Now', 'sendDailyBackupEmail')
    .addItem('Send Due Reminders Now', 'sendReminders')
    .addSeparator()
    .addItem('Turn On Daily 6 PM Backup & Reminders', 'installDailyBackupTrigger')
    .addItem('Turn Off Daily Backup & Reminders', 'removeDailyBackupTrigger')
    .addToUi();
}

// ─── Daily 6 PM: backup + reminders ─────────────────────────────────────────────────────────────────────────
/** The daily trigger. One failing part does not stop the other. */
function dailyTasks() {
  const errors = [];
  try { sendDailyBackupEmail(); } catch (err) { errors.push('Backup: ' + err); }
  try { sendReminders(); } catch (err) { errors.push('Reminders: ' + err); }
  if (errors.length) {
    try { MailApp.sendEmail({ to: BACKUP_EMAIL, subject: 'BizPulse daily tasks — problem', body: errors.join('\n'), name: SENDER_NAME }); } catch (err) { console.error(errors.join('\n')); }
  }
}

/** Exports the whole spreadsheet as .xlsx and emails it to BACKUP_EMAIL. */
function sendDailyBackupEmail() {
  const ss = spreadsheet_();
  const tz = Session.getScriptTimeZone() || LICENCE_TZ;
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('The backup could not be exported (HTTP ' + res.getResponseCode() + ').');
  const fileName = 'BizPulse Customers & Referrals ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + '.xlsx';
  const blob = res.getBlob().setName(fileName);
  const count = (name) => { const sh = ss.getSheetByName(name); return sh ? Math.max(sh.getLastRow() - 1, 0) : 0; };
  MailApp.sendEmail({
    to: BACKUP_EMAIL,
    subject: 'BizPulse daily backup — ' + stamp,
    body: 'Attached: ' + fileName + '\n\nCustomers: ' + count('Customers') + '\nReferrals: ' + count('Referrals') + '\nIssued Keys: ' + count('Issued Keys') + '\n\nSaved from "' + ss.getName() + '" at ' + stamp + ' (' + tz + ').',
    name: SENDER_NAME,
    attachments: [blob],
  });
  toast_('Backup emailed to ' + BACKUP_EMAIL + '.');
}

/**
 * Trial / temporary keys: one reminder when TRIAL_REMINDER_HOURS or fewer are left (features, referral, feedback).
 * Paid yearly keys: a renewal reminder RENEWAL_REMINDER_DAYS before expiry (30 and 3 days). Lifetime keys get none.
 * "Reminders Sent" records each one, so nothing is sent twice. Returns the number of emails sent.
 */
function sendReminders(now) {
  now = now instanceof Date ? now : new Date();
  const ss = spreadsheet_();
  const sh = ss.getSheetByName('Customers');
  if (!sh || sh.getLastRow() < 2) return 0;
  sheet_(ss, 'Customers', CUSTOMER_HEADERS); // older sheets: add the new headings first
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, CUSTOMER_HEADERS.length).getValues();
  const today = Utilities.formatDate(now, LICENCE_TZ, 'yyyy-MM-dd');
  let sent = 0;
  rows.forEach((r, i) => {
    const key = String(r[C.key]);
    const code = keyCodeOf_(key);
    if (!code || !isEmail_(String(r[C.email]))) return;
    let expires = isoOf_(r[C.expires]);
    if (!expires && code === 'TRIAL' && r[C.ts]) expires = addDaysIso_(Utilities.formatDate(new Date(r[C.ts]), LICENCE_TZ, 'yyyy-MM-dd'), 6); // rows from before this version
    if (!expires) return;
    const done = String(r[C.reminders] || '').split(/\s*,\s*/).filter(Boolean);
    const mark = (tag) => { done.push(tag); sh.getRange(i + 2, C.reminders + 1).setValue(done.join(', ')); sent++; };
    const keyTag = key.slice(-5);

    if (has_(TRIAL_DAYS, code)) {
      const hoursLeft = hoursLeft_(expires, now);
      const tag = 'TRIAL-' + keyTag;
      if (hoursLeft > 0 && hoursLeft <= TRIAL_REMINDER_HOURS && done.indexOf(tag) < 0) {
        if (sendTrialReminder_(r, code, expires, hoursLeft)) mark(tag);
      }
      return;
    }
    if (expires === 'Lifetime' || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return;
    const daysLeft = daysBetween_(today, expires);
    if (daysLeft < 0) return;
    // The nearest window we are inside (30 days, then 3 days). A missed run still sends it on the next day; when the first
    // run is already inside the 3-day window, only the 3-day reminder goes.
    const windowDays = RENEWAL_REMINDER_DAYS.slice().sort((a, b) => a - b).filter((d) => daysLeft <= d)[0];
    if (windowDays === undefined) return;
    const tag = 'RENEW' + windowDays + '-' + keyTag;
    if (done.indexOf(tag) < 0 && sendRenewalReminder_(r, expires, daysLeft)) mark(tag);
  });
  toast_(sent + ' reminder' + (sent === 1 ? '' : 's') + ' sent.');
  return sent;
}

function sendTrialReminder_(r, code, expires, hoursLeft) {
  const first = String(r[C.name]).split(/\s+/)[0];
  const pending = String(r[C.status]).indexOf('Payment Pending') === 0;
  const plan = planOfRow_(r);
  const lines = [
    'Dear ' + first + ',',
    '',
    'Your BizPulse ' + (pending ? 'temporary key' : 'free trial') + ' (' + EDITIONS[code] + ') ends on ' + niceDate_(expires) + ' — about ' + hoursLeft + ' hours from now.',
    '',
    pending
      ? 'Your order for ' + plan.name + ' is still awaiting payment. Once it is confirmed we will email your permanent key; enter it in Settings › License & Device and everything you have entered stays as it is.'
      : 'To keep working without a break, choose a plan at ' + PRICING_URL + '. Enter the new key in Settings › License & Device — every company and voucher you created during the trial is kept.',
    '',
    'A reminder of what ' + EDITIONS[FEATURE_EDITION[code]] + ' gives you:',
  ].concat(featureLines_(code), ['']);
  if (!pending && r[C.myRef]) lines.push.apply(lines, referralLines_(String(r[C.myRef])).concat(['']));
  lines.push('We would love your feedback: what worked well, and what should we improve? Just reply to this email' + (SUPPORT_WHATSAPP ? ' or WhatsApp us at https://wa.me/' + SUPPORT_WHATSAPP : '') + '.', '', 'Support: 10 AM – 6 PM, Monday to Saturday.', '— Srijee Creations');
  return mail_(String(r[C.email]), 'Your BizPulse ' + (pending ? 'temporary key' : 'trial') + ' ends ' + niceDate_(expires), lines);
}

function sendRenewalReminder_(r, expires, daysLeft) {
  const plan = planOfRow_(r);
  const lines = [
    'Dear ' + String(r[C.name]).split(/\s+/)[0] + ',',
    '',
    'Your ' + plan.name + ' licence (' + String(r[C.email]) + ') is due for renewal on ' + niceDate_(expires) + (daysLeft === 0 ? ' — today.' : ' — in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '.'),
    '',
    'Renew at ' + PRICING_URL + ' or reply to this email. Your renewal key is entered in Settings › License & Device; your data stays exactly as it is.',
    '',
  ].concat(r[C.myRef] ? referralLines_(String(r[C.myRef])) : [], ['', 'Support: 10 AM – 6 PM, Monday to Saturday.', '— Srijee Creations']);
  return mail_(String(r[C.email]), 'BizPulse renewal reminder — ' + plan.name + ' (' + niceDate_(expires) + ')', lines);
}

/** Schedules dailyTasks() every day at BACKUP_HOUR (script time zone). Replaces any earlier backup-only trigger. */
function installDailyBackupTrigger() {
  removeDailyBackupTrigger(true);
  ScriptApp.newTrigger('dailyTasks').timeBased().everyDays(1).atHour(BACKUP_HOUR).create();
  toast_('Daily backup to ' + BACKUP_EMAIL + ' and reminders at about ' + BACKUP_HOUR + ':00 (' + Session.getScriptTimeZone() + ').');
}

function removeDailyBackupTrigger(quiet) {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sendDailyBackupEmail' || t.getHandlerFunction() === 'dailyTasks')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  if (quiet !== true) toast_('Daily backup and reminders turned off.');
}

/** Never called: it only makes Apps Script ask for the Drive permission the .xlsx export needs. */
function driveScopeForBackup_() {
  DriveApp.getRootFolder();
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────
function spreadsheet_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // A sheet made by an earlier version: add any new heading at the end, without moving a column.
    const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    for (let i = 0; i < headers.length; i++) if (!have[i]) sh.getRange(1, i + 1).setValue(headers[i]).setFontWeight('bold');
  }
  return sh;
}

function customerRows_(sh) {
  return sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, CUSTOMER_HEADERS.length).getValues() : [];
}

function set_(sh, rowNo, col, value) {
  sh.getRange(rowNo, col + 1).setValue(value);
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'BizPulse Admin', 6); } catch (err) { /* no sheet open: a trigger or the web app */ }
}

function has_(obj, k) {
  return !!k && Object.prototype.hasOwnProperty.call(obj, k);
}

/** The plan of a sheet row (older rows without a plan: that edition's default plan). */
function planCodeOf_(row) {
  const p = String(row[C.plan] || '').toUpperCase();
  if (has_(PLANS, p)) return p;
  const e = String(row[C.edition] || '').toUpperCase();
  return has_(EDITION_DEFAULT_PLAN, e) ? EDITION_DEFAULT_PLAN[e] : 'PRO_SILVER';
}

function planOfRow_(row) {
  return PLANS[planCodeOf_(row)];
}

function newReferralCode_(taken) {
  for (let i = 0; i < 50; i++) {
    const code = 'BPR' + randomBlock_().slice(0, 5);
    if (!taken.has(code)) return code;
  }
  throw new Error('Could not create a referral code. Please try again.');
}

function firstRegistration_(rows, email) {
  const times = rows.filter((r) => String(r[C.email]).toLowerCase() === email).map((r) => new Date(r[C.ts])).filter((d) => !isNaN(d.getTime()));
  return times.length ? new Date(Math.min.apply(null, times.map((d) => d.getTime()))) : null;
}

/** Share link for the customer's own referral code. */
function whatsappUrl_(code) {
  return 'https://wa.me/?text=' + encodeURIComponent('I use BizPulse for GST billing and accounting. Register with my referral code ' + code + ' at ' + SITE_URL);
}

/** 1-click link that opens WhatsApp to this customer with a ready message (Customers › WhatsApp Link). */
function customerWhatsappLink_(fullName, mobile, message) {
  const m = digits_(mobile).slice(-10);
  if (!/^[6-9]\d{9}$/.test(m)) return '';
  return 'https://wa.me/91' + m + '?text=' + encodeURIComponent('Hi ' + String(fullName).split(/\s+/)[0] + ', ' + message + ' — Srijee Creations (BizPulse)');
}

function digits_(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

// ─── Dates (India dates, like the desktop app) ───────────────────────────────────────────────────────────────
function todayIso_() {
  return Utilities.formatDate(new Date(), LICENCE_TZ, 'yyyy-MM-dd');
}

function addDaysIso_(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addYearsIso_(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween_(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z').getTime() - new Date(fromIso + 'T00:00:00Z').getTime()) / 86400000);
}

/** Hours from now to the end of the key's last day (midnight after it, India time), rounded up. */
function hoursLeft_(expiresIso, now) {
  const end = new Date(addDaysIso_(expiresIso, 1) + 'T00:00:00+05:30');
  return Math.ceil((end.getTime() - now.getTime()) / 3600000);
}

/** A sheet cell → "yyyy-MM-dd" (Sheets may turn a typed date into a Date), "Lifetime", or ''. */
function isoOf_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, LICENCE_TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).replace(/^'/, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || s === 'Lifetime') return s;
  return '';
}

function niceDate_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  return Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1];
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

/** Text that starts with = + - @ would run as a formula in the sheet: store it as plain text. */
function safe_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function isEmail_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
