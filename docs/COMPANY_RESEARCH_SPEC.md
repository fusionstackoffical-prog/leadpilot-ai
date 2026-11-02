# LeadPilot AI — Company Research Specification (Addendum)

Addendum to `LeadPilot_AI_Complete_Dashboard_MVP_Spec (1).md`. Where the two differ, this
document wins for Company Research and for background processing. Everything else in the
original specification still applies, in particular §6 (permitted data sources only),
§7 (lead detail), §16 (`lead_sources`, `automation_runs`) and §18 (security and privacy).

Status: approved 2026-11-02. Implemented in phases (§12); this document describes the target.

---

## 1. Purpose

Turn imported companies into researched, evidence-backed company profiles that later feed
qualification, proposals, outreach and meeting preparation.

For each company LeadPilot should, using permitted sources only:

1. Find and analyze the company's public website and services.
2. Identify publicly available **business** contact information.
3. Find the company's public social profiles.
4. Record observations, likely challenges and potential opportunities.
5. Qualify and score the lead with an explanation.
6. Keep a dated history of every research run.

The operator controls all of this from the dashboard. No one operates n8n or configures
workflows by hand.

## 2. Decisions

| Topic | Decision |
|---|---|
| Background processing | LeadPilot's own TypeScript worker plus a scheduler. **n8n is not used.** LeadPilot owns job queuing, scheduling, retries, idempotency, failure handling and automation logs. This supersedes the n8n references in spec §2, §14 and §15 for research. |
| AI analysis | Claude API, approved for the AI analysis phase. Requires its own API key (`ANTHROPIC_API_KEY`), configured when that phase starts. Claude Code access is not API access. |
| Website discovery (places/search API) | Not selected. Options are researched and a provider recommended before that phase. |
| Email verification | Provider selection deferred to the email verification phase. |
| Company identity | A company **is** a `public.leads` row. Research never creates a second company record. |
| Navigation | **Company Research** is the 12th navigation item, placed after Lead Database. |

## 3. Facts, imported values and AI assessments

Every value shown in Company Research carries one of three labels, and they are never mixed:

| Label | Meaning | Requirement |
|---|---|---|
| **Imported** | Came from an uploaded Excel/CSV file | Shown as unverified. Links to the import and row it came from. |
| **Confirmed** | Found in a retrieved public source | Must reference a stored source (URL + retrieval time) **and** an exact quote from that source's stored text. Without both it cannot be saved as confirmed. |
| **AI assessment** | Interpretation by the model (observations, challenges, opportunities, fit) | Always labelled as an assessment, never as a fact. Should cite the confirmed facts it relies on. |

Rules:

- Never present an assumption, guess or AI output as confirmed company information.
- Never invent a company, website, email, phone number, person, social profile or URL.
- A "possible match" (e.g. a social profile or website found by search, not linked from the
  company's own site) stays **unconfirmed** until the operator confirms it.
- Research never overwrites imported lead values. It may propose a value; the operator accepts
  or rejects it, and the acceptance is recorded.
- Business contact information only: company emails, phones, addresses, and named people only in
  their published business role. Do not collect or infer sensitive personal information.

## 4. Company Research page (`/research`)

A searchable, paginated list of the workspace's companies (non-suppressed leads):

| Column | Source |
|---|---|
| Company name | `leads.company_name`, links to the profile |
| Website | `leads.website` (safe external link) |
| Location | city, state |
| Research status | Not researched / Queued / Running / Researched / Researched with warnings / Failed |
| Last researched | Completion time of the latest successful run, or "Never" |
| Lead score | `leads.lead_score`, or "Not scored" (never shown as 0) |
| Proposal status | From the proposals module once it exists; "—" until then |

Search: company, website, email, city, phone (same rules as the Lead Database).
Later filters: research status, score band, state, has website.
Actions (later phases): research one company, research selected companies, cancel a queued run.

## 5. Company profile (`/research/[leadId]`)

One page per company. Leads outside the caller's workspace return 404.

1. **Company overview** — name, location, address, source, date added.
2. **Website and business description** — website; description is Confirmed only when quoted from the site.
3. **Services offered** — Imported value plus Confirmed services from the website.
4. **Public social profiles** — Confirmed when linked from the company's own website; otherwise "possible match".
5. **Public business contact information** — Imported and Confirmed values side by side, each with its verification status.
6. **Business observations and insights** — AI assessment.
7. **Potential challenges and opportunities** — AI assessment, grounded in cited facts.
8. **Lead qualification and scoring** — current score, rubric version, factor breakdown, explanation.
9. **Research history** — every run with date, status, sources used and what changed.
10. **Proposal history** — from the proposals module.
11. **Outreach and communication history** — from the outreach module.
12. **Meeting history** — from the meetings module.
13. **AI meeting preparation** — brief generated from research history; AI assessment.
14. **Source evidence** — the import rows the company came from and every retrieved source.

Sections whose module does not exist yet show an honest empty state, never sample content.

## 6. Research runs and history

- Each research run is a **dated snapshot**. Its findings are append-only: never updated or deleted.
- New research never silently overwrites earlier research. The profile shows the latest completed
  run and offers a comparison with the previous run: findings added, removed and changed.
- Run statuses: `queued`, `running`, `completed`, `completed_with_warnings`, `failed`, `cancelled`.
- At most one queued/running run per company. Requests carry an idempotency key so a double click
  or retry never creates two runs.
- Every run records: who requested it, when, sources retrieved, provider and model, prompt version,
  attempts, errors, and usage/cost.

## 7. Data model (target — each migration is proposed and approved separately)

Additive only. Migrations 001–008 and the import tables/functions are not modified.

| Table | Purpose |
|---|---|
| `research_runs` | One row per run: status, requester, idempotency key, attempts, next attempt time, provider/model/prompt version, timings, error summary, usage. |
| `lead_sources` (spec §16) | Retrieved sources: URL, type (website page, search result, places, social, manual), HTTP status, retrieval time, content hash, storage path of the extracted text (private storage, not the table). |
| `research_findings` | Append-only findings per run: category, key, value, `kind` (`fact` or `inference`), source, exact evidence quote, confidence. A `fact` without a source and quote is rejected by the database. |
| `lead_score_history` | Score per run with rubric version and factors; the current score is copied to `leads.lead_score`. |
| `automation_runs` (spec §16) | Job/worker run log shown on Automation Logs. |
| `leads` additions | `research_status`, `last_researched_at`, maintained by the database for fast list filtering. |

Access: workspace members read; clients write only through a membership-checked request function;
all other writes come from the worker. Anonymous access is denied, matching existing tables.

## 8. Background processing

- Jobs live in the database. Workers claim them with `for update skip locked`, so two workers never
  process the same job.
- Bounded retries with exponential backoff; permanent failures are recorded with a readable reason.
- The worker runs in a protected route handler (shared secret), uses the service-role client only on
  the server, and re-checks the job's workspace before every write.
- A scheduler triggers the worker regularly; enqueueing also triggers it immediately.
- Every run appears on Automation Logs with status, counts and errors.

## 9. Retrieval and AI safety

- Website retrieval: respect robots.txt, rate limits, timeouts and size limits; fetch a small set of
  pages (home, about, services, contact); block private/internal network addresses; store extracted
  text, never render retrieved HTML.
- Retrieved content is data, never instructions. Model output is structured and validated in code;
  it can never trigger actions such as sending messages.
- Facts must quote the stored source text exactly; the quote is checked in code before saving.
- Per-run and per-workspace usage limits for paid APIs.
- No scraping of social platforms or bypassing of access controls, CAPTCHAs or rate limits.

## 10. Integrations

| Capability | Built by LeadPilot | External provider |
|---|---|---|
| Website retrieval and text extraction | Yes | Only for JavaScript-only sites (optional, later) |
| Website discovery for companies without a website | No | Places/search API — to be recommended |
| AI analysis | Prompts, validation, evidence checks | Claude API (approved) |
| Social profiles | Links found on the company's own website | None selected; search results stay "possible match" |
| Email verification | Syntax and MX checks only ("unknown" at best) | Provider deferred |
| Scheduling and retries | Yes | A scheduler to trigger the worker |

If a provider is not configured, the related action shows setup instructions and the rest of the
app keeps working.

## 11. Metrics

- **Researched companies:** distinct leads with at least one `completed` or
  `completed_with_warnings` run.
- **Research coverage:** researched companies ÷ non-suppressed leads.
- **Research failures:** runs with status `failed` in the period.

These follow spec §17: timezone-aware boundaries and no double counting.

## 12. Phases

| # | Scope | Migration | External API |
|---|---|---|---|
| 1 | Research list and company profile from existing lead and import data; navigation item; Lead Database links to profiles | No | No |
| 2 | Research schema (§7), access rules, request function; "provider not configured" states | Yes | No |
| 3 | Job runner, scheduler, retries, Automation Logs | Possibly | Scheduler |
| 4 | Website retrieval and deterministic facts | No | No |
| 5 | AI analysis with evidence-checked facts | No | Claude |
| 6 | Run history comparison | No | No |
| 7 | Scoring rubric and score history | Small | No |
| 8 | Website discovery for companies without a website | No | Places/search (to be chosen) |
| 9 | Email verification | Small | To be chosen |
| 10 | Proposals, outreach, meetings and meeting preparation | Yes | Claude |

Before any migration: the schema change is explained, the migration plan shown, a dry run performed,
and explicit approval given. Each phase keeps the import flow, Lead Database and Overview working,
and passes `npm run check`, the build, unit tests and an end-to-end test before it is committed.

## 13. Acceptance criteria

- [ ] Company Research appears in navigation and lists the workspace's companies.
- [ ] Each profile shows Imported, Confirmed and AI assessment values distinctly.
- [ ] No value is labelled Confirmed without a stored source and exact quote.
- [ ] New research never overwrites earlier research; history and comparisons are visible.
- [ ] One company never becomes two records through research.
- [ ] Other workspaces' companies return 404.
- [ ] Unconfigured providers show setup states, not fake results.
- [ ] Job failures are visible on Automation Logs with readable reasons.
- [ ] Import, Lead Database and Overview keep working.
