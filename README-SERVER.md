# Lead server + admin panel

The landing page form now sends every enquiry to a small Node.js server that:

1. saves the lead in **MongoDB** (`MONGO_URI` in `.env`) — or in `server/data/leads.json` if `MONGO_URI` is empty
2. emails the student a confirmation ("We’ve received your CHC33021 course enquiry")
3. emails the team a "New lead" alert with all details
4. shows every lead in a password-protected admin panel at **/admin**

## Run it

```bash
cd server
npm install        # first time only
npm start
```

- Landing page: http://localhost:3000
- Admin panel:  http://localhost:3000/admin

The form also works when the page is opened with Live Server (port 5500) — it posts to `http://localhost:3000`, so keep the server running.

## `.env` settings

| Key | What it does |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Mail account used to send both emails (port 465 = SSL) |
| `MONGO_URI` | MongoDB connection string. Leave empty to store leads in a JSON file |
| `MONGO_DB` *(optional)* | Database name if it is not in the URI |
| `ADMIN_PASSWORD` | Password for `/admin` — change it to your own |
| `SESSION_SECRET` | Signs the admin login cookie. Changing it signs everyone out |
| `ADMIN_NOTIFY_EMAIL` | Where "New lead" alerts go. Empty = sent to `SMTP_USER` |
| `MAIL_FROM_NAME` | Sender name shown in emails |
| `PORT` | Server port (default 3000) |

## Admin panel

- Stats: total, new, today, last 7 days
- Search by name / phone / email / postcode; filter by status, interest, state
- Click a lead to see every answer, UTM tracking, email delivery status, add notes, change status (new → contacted → enrolled → closed) or delete it
- **Export CSV** downloads all leads

## Security notes

- `.env`, `server/` and `node_modules/` are never served to the browser.
- Admin login is rate-limited (10 tries / 15 min); the form is limited to 6 submissions / 10 min per IP.
- Before going live, put the server behind HTTPS (the login cookie is marked `Secure` automatically on HTTPS).

## Deploy (Render – recommended, free tier works)

1. Push this repo to GitHub (the repo root is this folder: `index.html`, `package.json`, `server/`).
2. On https://render.com → **New → Blueprint** → choose the repo. `render.yaml` sets everything up.
3. Fill the secret values it asks for: `SMTP_USER`, `SMTP_PASSWORD`, `MONGO_URI`, `ADMIN_PASSWORD`, `ADMIN_NOTIFY_EMAIL`.
4. Deploy. The site is served at the Render URL; admin at `<url>/admin`.

Any Node host works the same way (Railway, a VPS, etc.):

```bash
npm install     # also installs server/ dependencies
npm start       # node server/server.js
```

Set the variables from `.env.example` in the host's dashboard and add `TRUST_PROXY=1` when it runs behind a proxy.
Static-only hosts (GitHub Pages, Netlify, Vercel static) can show the page but the form, emails and admin panel need this Node server.
If MongoDB Atlas is used, allow the host's IP in Atlas → Network Access (or `0.0.0.0/0`).
