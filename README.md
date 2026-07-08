# InstanceTrack

A shared-instance login/attendance tracker for a 6-person team: live "who's using it now" status, an admin-editable weekly time-slot schedule, per-person attendance/utilization, an in-app team chat, and automatic email reminders 5 minutes before each person's slot — sent reliably even if nobody has the dashboard open.

## Architecture — 100% free, no paid plan anywhere

| Piece | What it does | Where it runs | Cost |
|---|---|---|---|
| `public/` | Static HTML/CSS/JS: login, dashboard, schedule, attendance, chat | Render **Static Site** | Free forever |
| Firebase Auth + Firestore | Shared live data: users, status, schedule, usage logs, chat | Google's Firebase Spark tier | Free forever |
| `.github/workflows/reminder.yml` + `cron/` | Checks the schedule every 5 min and emails reminders | **GitHub Actions** scheduled workflow | Free (thousands of free minutes/month) |
| Resend | Actually sends the reminder emails | Free tier | Free (100/day) |

Two things could **not** be a single "just static HTML" file and still work for real:
- **Live shared status/chat across 6 people** needs a backend to hold shared state — that's Firestore.
- **Reminders that fire even with every tab closed** need a process that runs on a schedule regardless of browsers.

Note on hosting the reminder job: **Render's Cron Jobs are not free** (Render requires a minimum $1/month per cron job service, even for one that runs a few seconds). To keep this 100% free, the reminder job instead runs as a **GitHub Actions scheduled workflow** — same script (`cron/reminder.js`), just triggered by GitHub instead of Render.

This app is **live-only** — there's no offline/demo fallback. Every action (login, status toggle, session start/end, schedule edit, chat message) is persisted in Firestore, so it won't do anything useful until Firebase is configured (step 1 below). Opening `public/index.html` before that will show a "Firebase isn't configured yet" warning on the login page.

## 1. Firebase setup (shared live data)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (free Spark plan is enough).
2. **Build → Authentication → Get started → Email/Password** → enable it.
3. Under **Authentication → Users**, manually add your 6 team members' real emails + passwords.
4. **Build → Firestore Database → Create database** → start in **production mode**.
5. Paste these security rules (Firestore → Rules tab) — only logged-in users can read/write, and only admins can rewrite the schedule:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{email} {
         allow read: if request.auth != null;
         allow write: if request.auth != null && request.auth.token.email == email;
       }
       match /status/{email} {
         allow read: if request.auth != null;
         allow write: if request.auth != null && request.auth.token.email == email;
       }
       match /usageLogs/{id} {
         allow read: if request.auth != null;
         allow create: if request.auth != null && request.resource.data.email == request.auth.token.email;
         allow update: if request.auth != null && resource.data.email == request.auth.token.email;
       }
       match /chat/{id} {
         allow read: if request.auth != null;
         allow create: if request.auth != null && request.resource.data.email == request.auth.token.email;
       }
       match /config/schedule {
         allow read: if request.auth != null;
         allow write: if request.auth != null; // tighten to a custom claim/admin allow-list if you want stricter control
       }
       match /reminders/{id} {
         allow read, write: if false; // only the cron job's Admin SDK (server-side, bypasses rules) touches this
       }
     }
   }
   ```
6. **Project settings (gear icon) → General → Your apps → Add app → Web (`</>`)**. Copy the `firebaseConfig` object it gives you into [`public/js/firebase-config.js`](public/js/firebase-config.js), replacing the placeholder values. As soon as `apiKey` is no longer `"YOUR_API_KEY"`, the "not configured" warning disappears and the app is live.
7. In the same file, set `ADMIN_EMAILS` to the real email(s) allowed to edit the schedule.
8. Sign in once as each of the 6 users (via the deployed site) so their profile docs get created — or add `users/{email}` docs manually in the Firestore console with `{ email, name, role }`.
9. Set the schedule: sign in as an admin, go to the **Schedule** tab, edit each day, **Save schedule**. This writes `config/schedule` in Firestore.

## 2. Resend setup (sending the reminder emails)

1. Sign up free at [resend.com](https://resend.com) with any real email you control.
2. **API Keys → Create API Key** → copy it.
3. For the sender address, either:
   - Use Resend's shared testing domain immediately, no setup: `RESEND_FROM=InstanceTrack <onboarding@resend.dev>`, or
   - Verify your own domain under **Domains** for a branded sender.
4. Recipients (the 6 users' emails in your schedule) can be **any** address, including a temp-mail inbox like Yopmail, for testing — only the sender needs to be a real authenticated account.

## 3. Firebase Admin credentials (for the reminder job)

1. Firebase console → **Project settings → Service accounts → Generate new private key**. This downloads a JSON file — keep it secret, never commit it.
2. Base64-encode it (the reminder script reads it from one env var):
   - PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json")) | Set-Clipboard`
   - macOS/Linux: `base64 -i serviceAccountKey.json | pbcopy`
3. You'll paste this as a GitHub Actions secret in the next step.

## 4. Push to GitHub

```
cd instance-tracker
git init
git add .
git commit -m "InstanceTrack"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 5. Set up the reminder job on GitHub Actions (free)

1. On your repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Add these three:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — the base64 string from step 3
   - `RESEND_API_KEY` — from step 2
   - `RESEND_FROM` — e.g. `InstanceTrack <onboarding@resend.dev>`
2. (Optional) Same page, **Variables** tab → add `APP_TIMEZONE` (default `Asia/Kolkata`) and `REMINDER_MINUTES_BEFORE` (default `5`) if you want to override the defaults baked into the workflow.
3. That's it — [`.github/workflows/reminder.yml`](.github/workflows/reminder.yml) is already committed and will start running automatically on its `*/5 * * * *` schedule once secrets are set.
4. To test immediately without waiting: go to your repo's **Actions** tab → **Send instance slot reminders** → **Run workflow** → check the run's logs for `[reminder] ...` lines.

## 6. Deploy the static site to Render (free)

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New + → Blueprint**.
2. Pick the GitHub repo you just pushed. Render detects `render.yaml` and creates one service: `instance-tracker-site` (a Static Site — Render's Static Sites are free with no time limit).
3. Click **Apply**. Once deployed, open the site URL Render gives you — that's your live app.

(You could also skip the Blueprint and create the Static Site manually: root directory `public`, no build command.)

## Chat notifications

New chat messages from other people trigger three things at once, no extra setup needed:
1. A short synthesized beep (Web Audio API — no sound file to host). Browsers block audio until you've interacted with the page at least once; it'll play normally after your first click.
2. An in-app toast popup (bottom-right), stacked if several arrive close together.
3. A native OS/browser notification, if you grant notification permission when prompted (only fires while the tab isn't focused, to avoid double-alerting).

## Limitations to know about

- **Timezone**: the reminder job assumes the whole team is in `APP_TIMEZONE` (default `Asia/Kolkata`). Change it via the GitHub Actions repo variable if not.
- **GitHub Actions schedules aren't minute-precise** — GitHub may delay a scheduled run by several minutes during high load, and won't run more often than every 5 minutes. `reminder.js` accounts for this by checking a window (any slot starting within the next `REMINDER_MINUTES_BEFORE` minutes) rather than an exact-minute match, and dedupes via Firestore so a slot is never emailed twice even if checked across multiple runs.
- **Admin list is hardcoded** in `firebase-config.js` (`ADMIN_EMAILS`), not a Firestore-managed role — simplest option for a fixed 6-person team.
- **Firestore security rules** above are a reasonable baseline for a trusted internal team tool, not a hardened multi-tenant system.
- The `firebaseConfig` values are meant to be public (Firebase's web SDK config is not a secret) — access control comes from Firestore Rules + Auth, not from hiding the config.
- **Browser notifications** require the OS/browser permission prompt to be accepted; if denied, you still get the in-page toast + sound.

## File map

```
instance-tracker/
├─ render.yaml                    Render blueprint (static site only)
├─ .github/workflows/reminder.yml GitHub Actions schedule for the reminder job
├─ public/                        The static site (deploy this as-is)
│  ├─ index.html                  Login
│  ├─ dashboard.html              Main app shell
│  ├─ css/style.css
│  └─ js/
│     ├─ firebase-config.js       Your Firebase web config + admin emails (edit me)
│     ├─ data.js                  Unified data layer (Firestore-backed)
│     ├─ auth.js                  Login page logic
│     ├─ app.js                   Status/roster/schedule/attendance logic
│     └─ chat.js                  Team chat + popup/sound notifications
└─ cron/                          Run by the GitHub Actions workflow, not deployed to Render
   ├─ reminder.js                 Checks schedule every run, emails via Resend
   ├─ package.json
   └─ .env.example                Reference for the GitHub Actions secret names
```
