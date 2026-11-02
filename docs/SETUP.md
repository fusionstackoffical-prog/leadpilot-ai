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

## Deploy (Vercel)

1. Import the repository in Vercel (framework: Next.js).
2. Add the four environment variables above (Production + Preview).
3. Deploy, then add the production URL to Supabase Auth redirect URLs and set `NEXT_PUBLIC_SITE_URL`.
