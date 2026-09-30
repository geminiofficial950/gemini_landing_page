// Gemini Education – CHC33021 landing page server
// Serves the landing page, stores form leads, sends emails and hosts the admin panel.
//
//   cd server && npm install && npm start      →  http://localhost:3000   (admin: /admin)
//
// Settings come from ../.env (see README-SERVER.md).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const express = require('express');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');

// ---------------------------------------------------------------- config
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = 8;
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Gemini Education';
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_USER || '';
const DRY_RUN = process.env.MAIL_DRY_RUN === '1';

if (!ADMIN_PASSWORD) {
  console.error('✖ ADMIN_PASSWORD is not set in .env – refusing to start.');
  process.exit(1);
}
for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD']) {
  if (!process.env[key] && !DRY_RUN) console.warn(`⚠ ${key} is not set in .env – emails will fail.`);
}

// ---------------------------------------------------------------- storage
// MongoDB when MONGO_URI is set, otherwise a local JSON file (server/data/leads.json).
function jsonStore() {
  const DATA_DIR = path.join(__dirname, 'data');
  const DATA_FILE = path.join(DATA_DIR, 'leads.json');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let leads = [];
  try {
    leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(leads)) leads = [];
  } catch {
    leads = [];
  }
  let writeQueue = Promise.resolve();
  const persist = () => {
    writeQueue = writeQueue
      .then(async () => {
        const tmp = DATA_FILE + '.tmp';
        await fs.promises.writeFile(tmp, JSON.stringify(leads, null, 2));
        await fs.promises.rename(tmp, DATA_FILE);
      })
      .catch(err => console.error('✖ Could not save leads:', err));
    return writeQueue;
  };
  return {
    label: `JSON file (${path.relative(ROOT, DATA_FILE)})`,
    async init() {},
    async list() { return [...leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async count() { return leads.length; },
    async insert(rec) { leads.push(rec); await persist(); },
    async update(id, patch) {
      const lead = leads.find(l => l.id === id);
      if (!lead) return null;
      Object.assign(lead, patch);
      await persist();
      return lead;
    },
    async remove(id) {
      const i = leads.findIndex(l => l.id === id);
      if (i === -1) return false;
      leads.splice(i, 1);
      await persist();
      return true;
    },
  };
}

function mongoStore(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  let col;
  const noId = { projection: { _id: 0 } };
  return {
    label: 'MongoDB',
    async init() {
      await client.connect();
      const db = process.env.MONGO_DB ? client.db(process.env.MONGO_DB) : client.db();
      col = db.collection(process.env.MONGO_COLLECTION || 'leads');
      await col.createIndex({ id: 1 }, { unique: true });
      await col.createIndex({ createdAt: -1 });
      this.label = `MongoDB (db "${db.databaseName}", collection "${col.collectionName}")`;
    },
    async list() { return col.find({}, noId).sort({ createdAt: -1 }).toArray(); },
    async count() { return col.countDocuments(); },
    async insert(rec) { await col.insertOne({ ...rec }); },
    async update(id, patch) {
      return col.findOneAndUpdate({ id }, { $set: patch }, { ...noId, returnDocument: 'after' });
    },
    async remove(id) { return (await col.deleteOne({ id })).deletedCount === 1; },
  };
}

// MONGO_DB defaults to the database in the URI path; "test" is Mongo's fallback, so use a clearer name.
if (process.env.MONGO_URI && !process.env.MONGO_DB) {
  const dbInPath = (process.env.MONGO_URI.split('?')[0].split('/')[3] || '').trim();
  if (!dbInPath) process.env.MONGO_DB = 'gemini_landing';
}
const store = process.env.MONGO_URI ? mongoStore(process.env.MONGO_URI) : jsonStore();

// ---------------------------------------------------------------- form options (must match index.html)
const OPTIONS = {
  situation: {
    'New to the industry': 'New to the industry',
    'Already working in the industry': 'Already working in the industry',
    'Studied before': 'I have studied something similar before',
    'Not sure': 'Not sure — I need advice',
  },
  interest: {
    'Aged Care': 'Aged Care',
    'Disability Support': 'Disability Support',
    'Both': 'Both',
    'Not sure': 'Not sure yet',
  },
  startTime: {
    'ASAP': 'As soon as possible',
    'Within 1 month': 'Within 1 month',
    '1–3 months': 'In 1–3 months',
    'Researching': "I'm just researching",
  },
  state: {
    'Victoria': 'Victoria', 'New South Wales': 'New South Wales', 'Queensland': 'Queensland',
    'Western Australia': 'Western Australia', 'South Australia': 'South Australia', 'Tasmania': 'Tasmania',
    'ACT': 'ACT', 'Northern Territory': 'Northern Territory',
  },
};
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
const STATUSES = ['new', 'contacted', 'enrolled', 'closed'];

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function validateLead(body) {
  const errors = [];
  const lead = {};
  for (const key of ['situation', 'interest', 'startTime', 'state']) {
    const v = clean(body[key], 60);
    if (!Object.prototype.hasOwnProperty.call(OPTIONS[key], v)) errors.push(key);
    lead[key] = v;
  }
  lead.postcode = clean(body.postcode, 4);
  if (!/^\d{4}$/.test(lead.postcode)) errors.push('postcode');
  lead.firstName = clean(body.firstName, 60);
  if (lead.firstName.length < 2) errors.push('firstName');
  lead.phone = clean(body.phone, 20);
  if (!/^[0-9+()\s-]{8,20}$/.test(lead.phone)) errors.push('phone');
  lead.email = clean(body.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) errors.push('email');
  lead.utm = {};
  for (const k of UTM_KEYS) if (body[k]) lead.utm[k] = clean(body[k], 200);
  lead.pageUrl = clean(body.pageUrl, 500);
  return { lead, errors };
}

// ---------------------------------------------------------------- email
const transporter = nodemailer.createTransport(
  DRY_RUN
    ? { jsonTransport: true }
    : {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 465,
        secure: (Number(process.env.SMTP_PORT) || 465) === 465 || process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      }
);
const FROM = `"${MAIL_FROM_NAME}" <${process.env.SMTP_USER || 'no-reply@localhost'}>`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function summaryRows(lead) {
  return [
    ['Right now', OPTIONS.situation[lead.situation]],
    ['Area of interest', OPTIONS.interest[lead.interest]],
    ['Location', `${OPTIONS.state[lead.state]} ${lead.postcode}`],
    ['Preferred start', OPTIONS.startTime[lead.startTime]],
  ];
}

function emailShell(inner) {
  return `<!doctype html><html><body style="margin:0;background:#f5f7ff;font-family:Arial,Helvetica,sans-serif;color:#11142a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7ff;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e6e8f2">
      <tr><td style="height:6px;background:linear-gradient(90deg,#6b4eff,#3183ff,#14c7d9)"></td></tr>
      <tr><td style="padding:32px 32px 8px">${inner}</td></tr>
      <tr><td style="padding:20px 32px 28px;color:#8b91a3;font-size:12px;line-height:1.6;border-top:1px solid #eef0f7">
        Gemini Education · Education · Careers · Migration<br>
        Training, fees, delivery and placement details are subject to the relevant Registered Training Organisation.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function userEmail(lead) {
  const rows = summaryRows(lead)
    .map(([k, v]) => `<tr><td style="padding:10px 0;color:#69708a;font-size:14px;width:45%">${esc(k)}</td><td style="padding:10px 0;font-size:14px;font-weight:bold">${esc(v)}</td></tr>`)
    .join('');
  const html = emailShell(`
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">Thanks, ${esc(lead.firstName)} — we've received your enquiry</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#313754">
      Thank you for your interest in <strong>CHC33021 Certificate III in Individual Support</strong>.
      A Gemini course adviser will contact you shortly to explain the relevant course, provider, fees, delivery options and practical requirements.
    </p>
    <div style="background:#f3f1ff;border-radius:14px;padding:6px 18px;margin:0 0 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.65;color:#69708a">
      If any of these details are incorrect, simply reply to this email and let us know.
    </p>`);
  const text = `Thanks, ${lead.firstName} — we've received your enquiry.

Thank you for your interest in CHC33021 Certificate III in Individual Support. A Gemini course adviser will contact you shortly to explain the relevant course, provider, fees, delivery options and practical requirements.

${summaryRows(lead).map(([k, v]) => `${k}: ${v}`).join('\n')}

If any of these details are incorrect, simply reply to this email.

Gemini Education`;
  return { from: FROM, to: lead.email, replyTo: ADMIN_NOTIFY_EMAIL || undefined, subject: 'We’ve received your CHC33021 course enquiry', html, text };
}

function adminEmail(lead) {
  const all = [
    ['Name', lead.firstName], ['Phone', lead.phone], ['Email', lead.email],
    ...summaryRows(lead),
    ['Submitted', new Date(lead.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })],
    ...Object.entries(lead.utm || {}),
    ['Page', lead.pageUrl],
  ];
  const rows = all
    .map(([k, v]) => `<tr><td style="padding:8px 0;color:#69708a;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;font-size:14px;font-weight:bold;word-break:break-word">${esc(v)}</td></tr>`)
    .join('');
  const html = emailShell(`
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#5a63ff;font-weight:bold">New lead · CHC33021</p>
    <h1 style="margin:0 0 18px;font-size:22px">${esc(lead.firstName)} · ${esc(lead.phone)}</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin:22px 0 24px;font-size:13px;color:#69708a">Open the admin panel to update this lead's status.</p>`);
  const text = all.map(([k, v]) => `${k}: ${v}`).join('\n');
  return { from: FROM, to: ADMIN_NOTIFY_EMAIL, replyTo: lead.email, subject: `New lead: ${lead.firstName} – ${OPTIONS.interest[lead.interest]} (${lead.state})`, html, text };
}

async function sendEmails(lead) {
  const jobs = [['user', userEmail(lead)]];
  if (ADMIN_NOTIFY_EMAIL) jobs.push(['admin', adminEmail(lead)]);
  const emailStatus = { ...lead.emailStatus };
  let emailError;
  for (const [who, msg] of jobs) {
    try {
      await transporter.sendMail(msg);
      emailStatus[who] = 'sent';
    } catch (err) {
      emailStatus[who] = 'failed';
      emailError = clean(err && err.message, 300);
      console.error(`✖ ${who} email failed for ${lead.id}:`, err && err.message);
    }
  }
  try {
    await store.update(lead.id, emailError ? { emailStatus, emailError } : { emailStatus });
  } catch (err) {
    console.error('✖ Could not save email status:', err.message);
  }
}

// ---------------------------------------------------------------- tiny rate limiter
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) {
      const fresh = arr.filter(t => now - t < windowMs);
      fresh.length ? hits.set(k, fresh) : hits.delete(k);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  };
}

// ---------------------------------------------------------------- admin session (signed cookie)
const COOKIE = 'gem_admin';
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function isAuthed(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}
function setSession(req, res) {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ ok: false, error: 'Not signed in' });
}
function requireAjax(req, res, next) {
  // mutations must come from the admin UI (blocks simple cross-site form posts)
  if (req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ ok: false, error: 'Forbidden' });
  next();
}

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Never expose server code, data, env or source images through the static server
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path).toLowerCase();
  if (p.startsWith('/server') || p.startsWith('/node_modules') || p.split('/').some(seg => seg.startsWith('.'))) {
    return res.status(404).send('Not found');
  }
  next();
});

// ---- public lead API (CORS open so the page also works from Live Server)
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/api/leads', rateLimit({ windowMs: 10 * 60 * 1000, max: 6 }), express.json({ limit: '20kb' }), async (req, res) => {
  const { lead, errors } = validateLead(req.body || {});
  if (errors.length) return res.status(400).json({ ok: false, error: 'Please check your details.', fields: errors });

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'new',
    ...lead,
    course: 'CHC33021 Certificate III in Individual Support',
    ip: req.ip,
    userAgent: clean(req.get('user-agent'), 300),
    emailStatus: { user: 'pending', admin: ADMIN_NOTIFY_EMAIL ? 'pending' : 'skipped' },
  };
  try {
    await store.insert(record);
  } catch (err) {
    console.error('✖ Could not save lead:', err.message);
    return res.status(500).json({ ok: false, error: 'Could not save your enquiry. Please try again.' });
  }
  res.status(201).json({ ok: true, id: record.id });
  sendEmails(record); // after responding – the user never waits on SMTP
});

// ---- admin
const views = path.join(__dirname, 'views');

app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(views, isAuthed(req) ? 'admin.html' : 'login.html'));
});

app.post('/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
  if (safeEqual(req.body && req.body.password, ADMIN_PASSWORD)) {
    setSession(req, res);
    return res.redirect(303, '/admin');
  }
  res.redirect(303, '/admin?error=1');
});

app.post('/admin/logout', (req, res) => {
  clearSession(res);
  res.redirect(303, '/admin');
});

app.get('/admin/api/leads', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    res.json({ ok: true, leads: await store.list(), options: OPTIONS, statuses: STATUSES });
  } catch (err) {
    console.error('✖ Could not load leads:', err.message);
    res.status(500).json({ ok: false, error: 'Could not load leads' });
  }
});

app.patch('/admin/api/leads/:id', requireAuth, requireAjax, express.json({ limit: '5kb' }), async (req, res) => {
  const patch = { updatedAt: new Date().toISOString() };
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
    patch.status = req.body.status;
  }
  if (req.body.notes !== undefined) patch.notes = clean(req.body.notes, 2000);
  try {
    const lead = await store.update(req.params.id, patch);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    res.json({ ok: true, lead });
  } catch (err) {
    console.error('✖ Could not update lead:', err.message);
    res.status(500).json({ ok: false, error: 'Could not update lead' });
  }
});

app.delete('/admin/api/leads/:id', requireAuth, requireAjax, async (req, res) => {
  try {
    if (!(await store.remove(req.params.id))) return res.status(404).json({ ok: false, error: 'Lead not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('✖ Could not delete lead:', err.message);
    res.status(500).json({ ok: false, error: 'Could not delete lead' });
  }
});

app.get('/admin/export.csv', async (req, res) => {
  if (!isAuthed(req)) return res.redirect(303, '/admin');
  const cols = ['createdAt', 'status', 'firstName', 'phone', 'email', 'situation', 'interest', 'state', 'postcode', 'startTime', 'notes',
    ...UTM_KEYS, 'pageUrl', 'emailUser', 'emailAdmin', 'id'];
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // prevent spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let all;
  try {
    all = await store.list();
  } catch (err) {
    return res.status(500).send('Could not load leads');
  }
  const rows = all
    .map(l => cols.map(c => {
      if (UTM_KEYS.includes(c)) return cell(l.utm && l.utm[c]);
      if (c === 'emailUser') return cell(l.emailStatus && l.emailStatus.user);
      if (c === 'emailAdmin') return cell(l.emailStatus && l.emailStatus.admin);
      return cell(l[c]);
    }).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gemini-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + [cols.join(','), ...rows].join('\n'));
});

// ---- landing page + assets
app.use(express.static(ROOT, { dotfiles: 'deny', index: 'index.html', extensions: ['html'] }));

app.use((req, res) => res.status(404).send('Not found'));

(async () => {
  try {
    await store.init();
  } catch (err) {
    console.error(`✖ Could not connect to ${store.label}:`, err.message);
    process.exit(1);
  }
  app.listen(PORT, onListen);
})();

async function onListen() {
  console.log(`✔ Landing page:  http://localhost:${PORT}`);
  console.log(`✔ Admin panel:   http://localhost:${PORT}/admin`);
  console.log(`✔ Leads stored in ${store.label} – ${await store.count()} so far`);
  if (DRY_RUN) return console.log('ℹ MAIL_DRY_RUN=1 – emails are not really sent.');
  try {
    await transporter.verify();
    console.log(`✔ SMTP connected (${process.env.SMTP_HOST}) – emails will be sent from ${process.env.SMTP_USER}`);
  } catch (err) {
    console.error('✖ SMTP check failed:', err.message);
  }
}
