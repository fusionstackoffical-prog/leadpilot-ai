# LeadPilot AI — Setup

## Requirements

- Node.js 20.9+ (developed on Node 24), npm
- A Supabase project (supabase.com)

## 1. Install

```bash
npm install
```

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in values from **Supabase → Project Settings → API**.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Anon/publishable key (RLS-protected) |
| `NEXT_PUBLIC_SITE_URL` | Browser | App URL used in auth email links (e.g. `http://localhost:3000`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS. Never prefix with `NEXT_PUBLIC_`. |
| `RESEARCH_BOT_CONTACT_URL` | **Server only** | Company research only: public bot-information page (see [Company research worker](#company-research-worker)). |
| `RESEARCH_WORKER_SECRET` | **Server only** | Company research only: protects the worker endpoint. You create it. |

The two research variables are optional for the rest of the app: without them every page works as before and the research worker simply reports that it is not configured.

`NEXT_PUBLIC_*` values are inlined at **build** time. Set them before `npm run build` (on Vercel, add them in Project Settings → Environment Variables before deploying).

If variables are missing, every page redirects to `/setup`, which lists what is missing (never values).

## 3. Apply database migrations

Migrations live in `supabase/migrations/`. Either:

**Supabase CLI (recommended)**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npm run db:types   # regenerates src/types/database.ts from the linked schema; never edit it by hand
```

**or SQL editor:** paste each migration file, in filename order, into Supabase → SQL Editor and run it.

## 4. Configure Supabase Auth (dashboard)

These are dashboard settings; they are not stored in migrations.

1. **Authentication → Sign In / Providers**
   - **"Allow new users to sign up": Off** (invite-only).
   - **Email provider: keep enabled.** Turning it off disables password sign-in.
   - **"Allow anonymous sign-ins": keep Off** (see `docs/DATABASE_SECURITY.md`).
   - Email → **Confirm email: keep On**.
2. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000` for local development (the production URL when deploying).
   - Redirect URLs: add `http://localhost:3000/**`. In production add the exact `https://<your-domain>/**`; never a broad wildcard such as `https://*.vercel.app/**`.
3. **Authentication → Emails → Templates:** replace the link `href` in each template so the server verifies it at `/auth/confirm`:

   | Template                                  | Link                                                                       |
   | ----------------------------------------- | -------------------------------------------------------------------------- |
   | Magic Link                                | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink` |
   | Invite user                               | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`    |
   | Confirm signup                            | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`     |
   | Reset Password (when recovery is enabled) | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`  |

   Invite and recovery links continue to `/update-password` to set a password.

4. **Email delivery:** the built-in Supabase email service only reaches members of your Supabase organization and is rate-limited. Configure custom SMTP (Project Settings → Authentication → SMTP) before inviting anyone else.
5. **Leaked-password protection** requires the Pro plan; enable it if available.
6. **Create the first user:** Authentication → Users → **Add user** (with a password) or **Invite user**.

## 5. Run

```bash
npm run dev       # http://localhost:3000
npm run check     # typecheck + lint + format check
npm run build
npm run db:types  # after any migration: regenerates src/types/database.ts
```

## 6. First sign-in and onboarding

1. Open http://localhost:3000. You are sent to `/login`.
2. Sign in with your email and password.
3. With no workspace yet you land on `/onboarding`. Enter a workspace name and business timezone, then **Create workspace**. This calls `create_workspace()` and makes you the workspace **owner**.
4. You land on **Overview** (every metric is 0 until data exists). Settings shows the workspace, timezone and your role.
5. Revisiting `/onboarding` afterwards redirects to Overview; it never creates a second workspace.

## 7. Manual test checklist

- Signed out: every dashboard URL redirects to `/login?next=…`.
- Wrong password: "Incorrect email or password." and the email field stays filled.
- Signed in: all 11 sidebar pages load, and `/login` redirects to Overview.
- User menu → **Sign out** → `/login`; dashboard URLs redirect to login again.

## Company research worker

LeadPilot is a private, single-owner tool. The research worker is a protected endpoint, `POST /api/research/worker`, that you call yourself while developing locally. There is no scheduler and no public access; a scheduler is a later decision that depends on where the app is finally hosted. Calling the worker does nothing unless research runs have been queued, and nothing in the app queues them yet, so today a call reports `claimed: 0`.

Each call claims up to 3 queued research runs, fetches each company's own public website through the secure fetcher (robots.txt, rate limits, private-network blocking), stores the page text in the private `research-sources` bucket, saves the findings, and tidies up old text. It never starts research on its own and never touches imported lead values.

### 1. `RESEARCH_BOT_CONTACT_URL` (you must provide this)

Every request the bot makes identifies itself as `LeadPilotResearchBot/1.0 (+<this URL>)`, so the owner of any website it visits can find out who is behind it. The worker refuses to run (and leaves queued jobs untouched) until this is set to a valid URL.

It must be:

- a **public `https://` page on a domain you control**, with a real domain name (not `localhost` or an IP address), no username or password, and no spaces or parentheses;
- reachable by anyone on the internet, without signing in.

It is only a bot-information page. It does **not** make LeadPilot public and must not link to the dashboard. A page on your agency's own website is the natural place. It should say:

- who operates `LeadPilotResearchBot` (your agency) and that it is a private tool used for your own business research;
- what it does: it reads a handful of public pages from a company's own website, and obeys robots.txt (user-agent token `LeadPilotResearchBot`);
- how a website owner can ask to be excluded or get in touch (an address you choose to publish).

Put the URL in `.env.local` yourself. Nothing in the project supplies a default.

### 2. `RESEARCH_WORKER_SECRET` (you generate this)

The secret is a long random string that only you know. Generate one on your machine:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into `.env.local` as `RESEARCH_WORKER_SECRET=...` and restart the dev server. Requirements:

- at least 32 characters;
- **no spaces or other whitespace**, and only visible ASCII characters (letters, digits and ordinary symbols), because the secret travels in an HTTP header. The command above produces a valid value.

A secret that is too short or contains whitespace is treated as not configured: the worker answers `503 worker_not_configured` and runs nothing, even for a caller who presents that exact value. Never commit the secret, share it, or prefix it with `NEXT_PUBLIC_`. If it is ever exposed, generate a new one and replace it.

### 3. Calling the worker locally

With the dev server running (`npm run dev`), from PowerShell in the project folder:

```powershell
$url = 'http://localhost:3000/api/research/worker'
node -e "const { loadEnvConfig } = require('@next/env'); loadEnvConfig(process.cwd(), true); const s = process.env.RESEARCH_WORKER_SECRET; if (!s) { console.error('RESEARCH_WORKER_SECRET is not set in .env.local'); process.exit(1) } fetch(process.argv[1], { method: 'POST', headers: { Authorization: 'Bearer ' + s } }).then(async (r) => console.log(r.status, await r.text()), () => { console.error('Could not reach the worker. Is the dev server running?'); process.exit(1) })" $url
```

This reads your environment with Next.js's own loader (`@next/env`, already part of the project), exactly as `npm run dev` does. So it understands quoted values (`"..."` or `'...'`), an optional `export ` prefix, comments, and `.env.local` taking precedence over `.env`; and if the variable appears twice, it uses the same value the server uses. The secret is never printed, never stored in a shell variable or environment variable of your session, and never appears in your command history. The output is the HTTP status and the counts the worker returns. Keep the dev server reachable from your own machine only.

| Status | Meaning |
| --- | --- |
| 200 | A batch ran. Counts of claimed, completed, retried, failed, cancelled and lease-lost runs. |
| 401 | Missing or wrong secret. |
| 405 | Not a `POST` request. |
| 409 | A batch is already running; wait for it to finish. |
| 503 `worker_not_configured` | `RESEARCH_WORKER_SECRET` is missing, shorter than 32 characters, or contains whitespace or non-ASCII characters. |
| 503 `research_not_configured` | `RESEARCH_BOT_CONTACT_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing or invalid. Nothing was claimed. |
| 500 `worker_error` | Unexpected failure; details are never returned. |

Failed runs and their readable reasons are recorded on the run itself in the database.

### What the worker prints in the terminal

When something goes wrong with the worker itself (not with an individual company), one short fixed line is printed in the terminal running the dev server, prefixed with `[research-worker]`. A line never contains the secret, a request header, a URL, a company name, an identifier or any error text, only one of these fixed messages, optionally followed by a reason word such as `(transient)`:

| Message | Meaning |
| --- | --- |
| Research is not configured on the server, so no runs were claimed. | `RESEARCH_BOT_CONTACT_URL` or the server-side database key is missing or invalid. |
| Claiming queued research runs failed. | The database could not be reached or refused the request. |
| A research run's final state could not be confirmed; its lease will expire. | The result of a run could not be recorded; the run is picked up again automatically. |
| A research run stopped unexpectedly. | An internal fault affected one run; the others continued. |
| Maintenance could not purge old source text. / Maintenance could not remove unreferenced uploads. | Housekeeping failed; it is retried on the next call. Research is not affected. |
| A research worker batch failed. | An unexpected failure; the HTTP response was the generic `500`. |

Normal outcomes (completed, retried or failed runs) and rejected requests (wrong secret, wrong method) are not printed. Per-run results and reasons are in the database, as above.

## Using research from the dashboard (Phase 3D)

**Research does not run by itself yet.** Nothing is researched until the crawler contact URL (`RESEARCH_BOT_CONTACT_URL`) and the worker secret are configured, a research run is requested from the dashboard, **and you start the worker yourself** (see "Calling the worker locally" above). There is no scheduler in this phase. The dashboard only requests research and shows what the worker saved.

### Seeing research status

- **Company Research** (the list) shows each company's real research status and when it was last researched. Companies that have never been researched say "Not researched" and "Never".
- Statuses: **Not researched**, **Queued** (waiting for the worker), **Running**, **Researched**, **Researched with warnings**, **Failed** and **Cancelled**. If the latest attempt failed or was cancelled but an earlier one succeeded, the earlier results stay available and the list says so.
- Open a company to see its full research profile. While a run is queued or running, the page refreshes itself every 8 seconds, but only while that browser tab is visible, and it stops by itself when the run finishes.

### Requesting research

1. Open the company's profile and select **Research company** (**Research again** if it has been researched before). The request is queued and the page says so.
2. Run the worker. The status moves to **Running**, then to a final status.

The button is disabled, with the reason written beside it, when:

- **Research isn't set up.** The profile lists what is missing by name: the crawler contact page (`RESEARCH_BOT_CONTACT_URL`), the worker secret (`RESEARCH_WORKER_SECRET`) and the server-side database key (`SUPABASE_SERVICE_ROLE_KEY`). Values are never shown. While anything is missing nothing is queued, so no run can get stuck waiting for a worker that couldn't run it.
- **The company needs a valid website.** A company with no website, or a website value that doesn't look like a public web address (an email address, an IP address, `localhost`), can't be researched. The check is made on the address alone; nothing is looked up or contacted. Fix the value in the imported data first.
- **The company is suppressed.**
- **A run is already queued or running.** Only one run per company can be active, and a repeated click can't create a second one.

### Cancelling

While a run is active, **Cancel research** appears for the person who requested it and for workspace owners and admins (it asks you to confirm). A queued run is cancelled immediately; a running one stops at its next checkpoint, usually within seconds.

### Reading the results

- Every item is **Confirmed** or **Unconfirmed**. A confirmed item shows the page it came from and the exact quote that supports it, and that quote was checked against the stored page text. An unconfirmed item (for example an address inside a customer testimonial) is shown for review only.
- **Warnings** list pages that couldn't be read and similar problems. **Missing information** lists what wasn't found: "Not found in the pages researched." It is derived from what was found and never guessed.
- **Research history** keeps every run as a dated snapshot with its status, pages read, finding counts and, for a failed run, the reason and whether a retry is permitted. Select **View results** on an earlier run to see what it saved. Earlier results are never overwritten.
- The stored text of the pages is private and is never displayed; only the page address, title, retrieval time and the supporting quote are shown. Everything taken from a company's website is shown as plain text.
- AI observations, challenges and opportunities stay empty: AI analysis is not built yet.

## Deploy (Vercel)

1. Import the repository in Vercel (framework: Next.js).
2. Add the four environment variables above (Production + Preview).
3. Deploy, then add the production URL to Supabase Auth redirect URLs and set `NEXT_PUBLIC_SITE_URL`.
