# LeadPilot AI --- Complete Dashboard & MVP Build Specification

**Project:** LeadPilot AI\
**Product:** HVAC Lead Generation, Qualification, Outreach & Sales
Command Center\
**Target market:** US HVAC contractors\
**Primary goal:** Help the operator discover and qualify HVAC
businesses, review AI-generated outreach, track outreach activity, and
manage prospects through to closed deals.\
**MVP deadline:** 7--8 hours for a functional first version.\
**Design reference:** Dark charcoal/black analytics dashboard with warm
orange accents, thin borders, compact typography, and data-dense cards.

------------------------------------------------------------------------

## 1. Build Objective

Build a polished, responsive dashboard inspired by the supplied dark
analytics dashboard reference. The visual style should feel like a
modern premium SaaS analytics product---not a generic admin template.

The dashboard must make it easy to answer:

1.  How much lead data do we have across all imported Excel/CSV files?
2.  How many rows are there, and how many unique companies do those rows
    represent?
3.  How many leads have been verified and qualified?
4.  How many outreach messages have been sent across email, LinkedIn,
    and Instagram?
5.  How many replies, positive replies, meetings, proposals, and closed
    deals have resulted?
6.  Which campaigns and channels perform best?
7.  What needs approval, follow-up, correction, or attention today?
8.  Are automations running successfully, or are there errors?

**Important:** All metrics must come from actual imported files and
saved application records. Never hardcode sample metrics into production
UI. If there is no data yet, show `0`, an empty state, or `No data yet`.
Demo data may only be used in an explicitly labeled demo/preview mode.

## 2. Recommended MVP Architecture

Use the simplest architecture that can be implemented reliably within
the deadline.

-   **Frontend:** Next.js with TypeScript.
-   **Styling:** Tailwind CSS or the existing project styling system.
-   **Icons:** Lucide icons.
-   **Charts:** Recharts or an equivalent existing chart library.
-   **Database:** Supabase/PostgreSQL.
-   **Workflow automation:** n8n.
-   **AI:** Claude API or another model API that the operator has
    configured and paid access to.
-   **File imports:** Excel `.xlsx`, `.xls` if supported by the chosen
    parser, and CSV.
-   **Approval/review interface:** The dashboard itself. Google Sheets
    can be a temporary fallback, not a mandatory dependency.
-   **Deployment:** Use the existing repository and deployment where
    possible. Do not rebuild working infrastructure.

Do not assume credentials, API keys, integrations, existing database
tables, or a working n8n deployment exist. Use environment variables and
provide a clear setup checklist.

### Architecture principles

1.  Supabase is the source of truth for persisted leads, campaigns,
    drafts, outreach events, and sales opportunities.
2.  Excel/CSV imports are stored as import records with row-level import
    results.
3.  n8n performs background discovery, verification, AI
    scoring/drafting, and permitted outreach tasks.
4.  The frontend calls secure server-side routes or Supabase with
    appropriate Row Level Security.
5.  Never expose service-role keys, model API keys, or private
    credentials in client-side code.
6.  Every send attempt and outcome must be recorded.
7.  Social outreach must use permitted methods and must not bypass
    platform limits or access controls.
8.  Human approval is required before a message is sent in the MVP.

## 3. Visual Design System

### Overall look

-   Dark, high-contrast SaaS dashboard.
-   Main background: near-black navy/charcoal.
-   Cards: slightly lighter dark navy.
-   Primary accent: warm orange.
-   Secondary accents: muted blue, green, and red only where
    semantically useful.
-   Borders: thin, low-contrast blue-gray.
-   Text: high-contrast white for primary text and muted gray for
    metadata.
-   Use generous but efficient spacing. Keep information dense without
    making the interface cluttered.
-   Rounded corners should be moderate, not excessively pill-shaped.
-   Use subtle hover states and transitions. Avoid heavy gradients,
    excessive glow, and decorative animations.
-   Use a consistent icon set (Lucide).
-   The dashboard should look credible and production-oriented.

### Suggested tokens

These are starting points, not strict requirements:

-   App background: `#070B12`
-   Sidebar background: `#080E17`
-   Main card background: `#0B1420`
-   Elevated card background: `#101B29`
-   Border: `#1E3042`
-   Primary text: `#F3F6FB`
-   Secondary text: `#9BAABD`
-   Muted text: `#718198`
-   Primary orange: `#FF7900`
-   Orange hover: `#FF922E`
-   Success: `#26C281`
-   Warning: `#F5B544`
-   Error: `#F06464`
-   Info: `#5C9DFF`

Check contrast for text, badges, charts, and controls. Do not rely on
color alone to convey status.

### Layout

Desktop layout:

-   Fixed or sticky left sidebar, approximately 240--255 px wide.
-   Top header with page title, subtitle, date-range filter,
    market/location filter where relevant, and export action.
-   Main content area with responsive grids.
-   Overview page uses multiple compact KPI cards, a main chart, data
    inventory, channel performance, Excel inventory, lead qualification
    chart, and recent activity.
-   Use responsive breakpoints so the sidebar can collapse or become a
    mobile drawer.
-   On mobile, stack cards into one column and make tables horizontally
    scrollable or provide compact card rows.

## 4. Sidebar Navigation

Create the following navigation items:

1.  **Overview**
2.  **Lead Discovery**
3.  **Lead Database**
4.  **Excel Imports**
5.  **Approval Queue**
6.  **Outreach**
7.  **Follow-ups**
8.  **Sales Pipeline**
9.  **Reports**
10. **Automation Logs**
11. **Settings**

Use active-state styling with an orange accent and subtle background.
Show small count badges for pending approvals and follow-ups when those
counts exist.

## 5. Overview Dashboard

This is the default page. It should summarize the whole system without
requiring the operator to open other sections.

### 5.1 Header

-   Page title: `Outreach Analytics` or `Overview`
-   Subtitle:
    `Track lead generation, outreach performance, and sales pipeline in real time.`
-   Date range selector: Today, Last 7 days, Last 30 days, This month,
    Custom.
-   Market filter: US / all states, with optional state and city
    filters.
-   Export button: export the current report or selected data to CSV.
-   Refresh indicator and last-updated timestamp.

All date filters should affect the relevant charts, KPIs, and activity
lists. Clearly indicate whether a metric is all-time or period-specific.

### 5.2 Primary KPI cards

Show these cards prominently:

1.  **Total Records in Excel Sheets**
    -   Total imported data rows across all successful imports.
    -   Explain whether header rows are excluded.
2.  **Unique Companies**
    -   Number of distinct companies after normalization/deduplication.
3.  **New Leads Today**
    -   New lead records created today in the configured business
        timezone.
4.  **Verified Contacts**
    -   Contacts meeting the defined verification criteria.
5.  **Qualified Leads**
    -   Leads that pass the configured qualification threshold.
6.  **Total Messages Sent**
    -   Count of successful sends, not drafts or failed attempts.
7.  **Replies Received**
    -   Inbound replies recorded from connected integrations or entered
        manually.
8.  **Positive Replies**
    -   Replies classified as positive, with a way to review the
        classification.
9.  **Meetings Booked**
    -   Meetings with a recorded booking status.
10. **Deals Won**

-   Sales opportunities marked won.

Each KPI card should show: - Metric label. - Current value. - Optional
comparison with the previous period only if enough historical data
exists. - Small trend indicator or sparkline where useful. - Tooltip or
info icon explaining how the metric is calculated.

Do not show a fabricated percentage change. If comparison data is
unavailable, show no comparison.

### 5.3 Outreach Activity Over Time

Line/area chart with selectable period: - Messages sent - Replies
received - Positive replies

Requirements: - X-axis uses dates. - Hover tooltip shows exact counts. -
Legend can toggle series. - Chart responds to the global date filter. -
Counts must use saved outreach events. - Provide an empty state when no
events exist.

### 5.4 Data Inventory panel

This section is especially important. It must answer: **"How much data
do we have across all our Excel sheets?"**

Display:

-   Total Excel/CSV files imported.
-   Total worksheets detected.
-   Total data rows across imports.
-   Total distinct companies.
-   Duplicate rows detected.
-   Rows with missing company name.
-   Rows with missing website.
-   Rows with missing email.
-   Rows with missing phone.
-   Verified business emails.
-   Import failures or rows requiring review.
-   Last successful import date/time.

Definitions must be consistent: - **Total rows:** all data rows
imported, excluding header rows, across import history or current active
dataset---label the chosen definition clearly. - **Unique companies:**
distinct normalized company identities, not simply row count. -
**Duplicate rows:** rows identified as duplicates using normalization
and matching rules. - **Verified email:** only mark as verified if a
defined verification method actually ran and succeeded. An email being
present in a spreadsheet is not proof it is valid. - **Worksheets:**
count actual worksheets parsed from imported workbooks, not a guessed
number.

Add a `View Excel Imports` link/button.

### 5.5 Channel Performance panel

Show separate rows/cards for:

-   Email
-   LinkedIn
-   Instagram

For each channel, show as available: - Prospects contacted. - Messages
sent successfully. - Failed sends. - Replies received. - Positive
replies. - Meetings attributed. - Reply rate. - Positive reply rate.

Metric definitions: - Reply rate = unique contacted prospects who
replied / unique contacted prospects, for the selected period and
channel. - Positive reply rate = unique contacted prospects with a
positive reply / unique contacted prospects. - Do not divide by message
count if a single prospect can receive multiple messages without clearly
labeling that alternate calculation. - If a channel has no integration,
label its activity as manually tracked or unavailable. Do not imply that
the app can automatically read social messages without an authorized
integration.

### 5.6 Excel Sheet Inventory table

Show recently imported workbooks and a `View all` action.

Suggested columns: - File name - File type - Number of worksheets -
Total rows - Unique companies - Duplicate rows - Last imported - Import
status - Actions

Actions: - View details - Preview rows - Download original file if
stored - Re-import (with duplicate handling) - Delete/archive import
(with confirmation and appropriate permissions)

Show pagination and sorting. Use real import records only.

### 5.7 Lead Qualification panel

A bar chart grouping leads by score bands:

-   High fit: 90--100
-   Good fit: 70--89
-   Medium fit: 50--69
-   Low fit: 30--49
-   Not a fit: 0--29

For each band show count and percentage. Make bands configurable later.
Leads without a score should be shown separately as `Not scored`; do not
treat missing scores as zero.

### 5.8 Recent Activity feed

Show a timestamped feed of real system events, for example: - Excel file
imported - New lead discovered - Lead verified - Lead qualified -
Message draft created - Message approved - Message sent - Reply
received - Follow-up scheduled - Meeting booked - Proposal sent - Deal
won/lost - Workflow failed

Each event should link to its relevant record where possible. Timestamps
should use the user's selected timezone and clearly distinguish relative
times from absolute dates.

### 5.9 Follow-ups Due widget

Show: - Follow-ups due today - Overdue follow-ups - Upcoming
follow-ups - Lead/company name - Channel - Due time/date - Status -
Quick actions: Open lead, Mark completed, Reschedule

Do not send follow-ups automatically unless the configured workflow,
consent/compliance rules, and applicable platform rules permit it.

### 5.10 Automation Health widget

Show the status of configured workflows: - Lead discovery - Website
verification - AI qualification/drafting - Excel import - Outreach
sending - Reply synchronization - Follow-up processing

For each: - Enabled/disabled - Last run time - Last run result - Error
summary if failed - Link to logs

Only show workflows that are actually configured. Do not display a green
"operational" status unless it is supported by a recent successful run
or health check.

### 5.11 Sales Pipeline and Revenue

Show pipeline stages: - New - Qualified - Interested - Meeting booked -
Meeting completed - Proposal sent - Negotiation - Won - Lost -
Disqualified

Display: - Lead count per stage - Total estimated pipeline value - Won
revenue - Average deal value for won deals - Deals won/lost over the
selected period

Use currency consistently (default USD). Keep **pipeline value**
separate from **revenue actually won/received**. Only report received
revenue if payment data is available; otherwise label it
`Won deal value`.

------------------------------------------------------------------------

## 6. Lead Discovery Page

Purpose: launch and monitor discovery jobs using an authorized,
permitted data source.

### Controls

-   Country (default: United States)
-   State
-   City or ZIP code
-   Business category (default: HVAC contractor)
-   Optional search terms
-   Maximum results for a run
-   Data source selector, showing only configured sources
-   `Start Discovery` button
-   Recent discovery runs list

### Run status

-   Queued
-   Running
-   Completed
-   Completed with warnings
-   Failed
-   Cancelled

Display: - Results found - New records added - Existing records
skipped - Duplicates detected - Verification failures - Run duration -
Error details

### Important data-source requirements

-   Do not implement unauthorized scraping or bypass source access
    controls, CAPTCHAs, or rate limits.
-   Respect source terms, robots/access rules where applicable, rate
    limits, and privacy requirements.
-   Use a permitted search/business-data API or an approved import
    source.
-   Store the source URL and retrieval timestamp for each discovery
    result.
-   Never invent a company, email, phone number, decision-maker, or
    source URL.
-   If there is no configured discovery provider, show setup
    instructions instead of pretending discovery works.

For the first MVP, a manual CSV/Excel import plus assisted discovery can
be a fallback if the API setup takes too long.

------------------------------------------------------------------------

## 7. Lead Database Page

A searchable, filterable table for all companies and prospects.

### Table columns

-   Checkbox/select
-   Company name
-   Contact/decision-maker (if verified)
-   Website
-   Email
-   Phone
-   City
-   State
-   Lead score
-   Verification status
-   Priority
-   Latest channel
-   Outreach status
-   Last activity
-   Next follow-up
-   Created date
-   Actions

### Filters

-   Search company/contact/email/domain
-   State/city
-   Lead score band
-   Verified/unverified
-   Missing contact data
-   Qualification status
-   Outreach status
-   Channel
-   Campaign
-   Date discovered
-   Suppressed/opted-out status

### Row actions

-   View lead details
-   Edit verified fields
-   View source evidence
-   Re-run verification if a verifier exists
-   Generate draft
-   Add to campaign
-   Export selected leads
-   Mark do-not-contact
-   Merge duplicate records with confirmation

### Lead detail drawer/page

Include: - Company profile - Contact details - Source URLs and evidence
snippets - Verification status and timestamp - AI score and
explanation - AI-identified opportunity, grounded in evidence - Outreach
timeline - Drafts and sent messages - Replies and
sentiment/classification - Follow-up history - Campaign membership -
Sales opportunity and notes - Suppression/opt-out status

------------------------------------------------------------------------

## 8. Excel Imports Page

This is a core feature, not an optional extra.

### Import workflow

1.  Upload `.xlsx`, supported `.xls`, or `.csv`.
2.  Validate file type and size.
3.  Parse workbook and list detected worksheets.
4.  Let the user choose which worksheet(s) to import.
5.  Preview the first rows and detected column names.
6.  Map source columns to canonical fields.
7.  Show validation warnings before confirming.
8.  Import rows and display a progress indicator.
9.  Show an import report when complete.

### Canonical fields to support

-   Company name
-   Contact first name
-   Contact last name
-   Contact full name
-   Job title
-   Business email
-   Phone
-   Website
-   Street/address
-   City
-   State
-   ZIP/postal code
-   Country
-   Services
-   Source URL
-   Source name
-   Notes
-   Existing lead status

Preserve original source columns in import staging or raw JSON so
information is not silently lost.

### Duplicate handling

Use a combination of: - Normalized website domain - Normalized company
name - Normalized business email - Phone number when available

Do not merge solely because two company names are similar. Show likely
matches for review where confidence is low.

Import choices: - Add new records only - Update existing records with
non-empty values - Skip duplicates - Import all rows into staging for
review

Do not overwrite a verified value with an empty or unverified value
without confirmation.

### Import summary

After each import show: - File name - Worksheets scanned - Rows read -
Rows imported - New companies created - Existing records updated -
Duplicates skipped - Invalid rows - Rows missing key fields - Failed
rows and reasons - Start/end time

Provide CSV download of failed rows with reasons. Store import metadata
and row counts in the database.

------------------------------------------------------------------------

## 9. Approval Queue

All AI-generated messages must enter a review queue before sending.

### Queue table

-   Company
-   Contact
-   Lead score
-   Channel
-   Campaign
-   Draft created
-   Evidence/source link
-   Approval status
-   Actions

### Draft review interface

Display: - Verified company facts used for personalization - Source
links supporting those facts - Draft message - Channel-specific
character guidance where relevant - Editable message text - Approve -
Reject - Regenerate - Save edits

Approval states: - Draft - Pending review - Approved - Rejected -
Queued - Sent - Failed - Cancelled

### Safety requirements

-   Approval applies to a specific message version. If the message is
    edited after approval, it must return to pending approval.
-   The system must not send unapproved messages.
-   Do not send to contacts on the suppression list or who have opted
    out.
-   Prevent accidental duplicate sends.
-   Display a final confirmation before bulk send.
-   Use conservative batch sizes and rate limits.
-   Keep an audit trail of who approved what and when.

------------------------------------------------------------------------

## 10. Outreach Center

Manage campaigns and track outreach events.

### Campaigns

Campaign fields: - Campaign name - Target segment - Market/region -
Channels used - Start date - End date - Status - Daily send target -
Actual leads processed - Actual sends - Replies - Positive replies -
Meetings - Deals - Notes

Campaign statuses: - Draft - Ready for review - Active - Paused -
Completed - Archived

### Outreach log

Every attempt must have a record containing: - Lead ID - Campaign ID -
Channel - Message draft/version ID - Recipient/contact identifier -
Created time - Approved time and approver - Send attempt time - Result -
Provider message ID if available - Error code/message if failed -
Delivery status if provider supports it - Reply status and timestamps
when known - Opt-out/stop status

Use a unique provider message ID where available to prevent duplicate
event processing.

### Sending behavior

-   Email sends only through a configured, authorized email provider.
-   Follow applicable anti-spam laws and provider requirements,
    including sender identification, truthful subject lines, valid
    opt-out handling, and suppression.
-   Social messages should be sent through permitted platform methods.
    Do not automate unauthorized scraping, bulk DM spam, or actions that
    bypass platform restrictions.
-   If social sending is not integrated, allow the operator to copy the
    approved draft and mark the send as manually completed.
-   Track manual sends distinctly from API-confirmed sends.

### Reply handling

-   Automatically sync replies only where an authorized integration
    exists.
-   Otherwise allow manual logging.
-   AI may classify a reply as Positive, Neutral, Negative,
    Unsubscribe/Stop, or Unclear.
-   Store the original reply and allow the operator to correct its
    classification.
-   An unsubscribe/stop request must immediately suppress future
    outreach across channels.

------------------------------------------------------------------------

## 11. Follow-ups Page

Show a task list and calendar/list view.

Fields: - Lead - Campaign - Channel - Last contact date - Follow-up due
date - Follow-up sequence step - Draft - Status - Completion time -
Notes

Statuses: - Due - Upcoming - Overdue - Completed - Snoozed - Cancelled

Controls: - Mark completed - Snooze/reschedule - Open lead - Draft
follow-up - Cancel sequence - Mark do-not-contact

Do not follow up if: - The lead opted out or requested no further
contact. - A reply makes the planned follow-up inappropriate. - The
contact is suppressed. - The campaign is paused or the operator has
disabled follow-ups.

The first MVP can use manual follow-up tasks and reminders if reliable
automatic sending is not ready.

------------------------------------------------------------------------

## 12. Sales Pipeline Page

Kanban board or stage-based table.

Stages: 1. New 2. Qualified 3. Contacted 4. Interested 5. Meeting booked
6. Meeting completed 7. Proposal sent 8. Negotiation 9. Won 10. Lost 11.
Disqualified

Each opportunity includes: - Lead/company - Contact - Opportunity
title - Estimated deal value (USD) - Stage - Probability, if used -
Expected close date - Last activity - Next action - Owner - Notes -
Won/lost reason - Actual received payment, only if tracked

Display summary metrics: - Open opportunities - Pipeline value -
Weighted pipeline value, if probability values are configured - Won deal
value - Received revenue, only if payment records exist - Average won
deal value - Win rate - Time to close

Do not treat estimated opportunity value as actual revenue.

------------------------------------------------------------------------

## 13. Reports & Analytics

Include report filters by: - Date range - Campaign - Channel -
State/city - Lead score - Lead source

Reports: - Leads discovered by day/source - Verification success rate -
Qualified leads by score band - Messages sent by channel - Replies and
positive replies by channel - Meetings booked - Proposal and deal
conversion - Campaign comparison - Follow-up completion - Email
bounce/failure rate where available - Opt-out rate - Automation error
rate - Data quality report

Provide CSV export. Only include charts that have actual data. Use
explicit metric definitions and do not fabricate conversion rates.

------------------------------------------------------------------------

## 14. Automation Logs Page

Display recent n8n workflow runs or synced run events.

Fields: - Workflow name - Run ID - Started at - Duration - Status -
Records processed - Records succeeded - Records skipped - Errors - Error
details

Filters: - Workflow - Date range - Status

Actions: - View run details - Retry if the workflow supports safe
retries - Open n8n workflow link if configured

Do not retry non-idempotent actions such as message sends blindly.
Confirm whether the action already succeeded before retrying.

------------------------------------------------------------------------

## 15. Settings Page

MVP settings: - Business/operator timezone - Default market and state
filters - Lead scoring thresholds - Default daily discovery target -
Default daily outreach target - Connected provider status - AI provider
configuration status (never display secret keys) - Email provider
status - n8n webhook/configuration status - Suppression list - Data
retention/export options - User access and role, if authentication is
implemented

API keys must be stored securely in server-side environment variables or
secure credential storage. Do not store secrets in client-side local
storage or display them in the interface.

------------------------------------------------------------------------

## 16. Data Model

Use Supabase/PostgreSQL. Adjust names to fit existing infrastructure
rather than duplicating existing tables.

### `leads`

Suggested fields: - `id` UUID primary key - `company_name` text -
`normalized_company_name` text - `website` text - `normalized_domain`
text - `business_email` text - `phone` text - `address` text - `city`
text - `state` text - `postal_code` text - `country` text - `services`
JSONB or text - `decision_maker_name` text nullable -
`decision_maker_title` text nullable - `lead_score` integer nullable -
`lead_score_reason` text nullable - `qualification_status` text -
`verification_status` text - `source_url` text nullable - `source_name`
text nullable - `discovered_at` timestamptz - `created_at` timestamptz -
`updated_at` timestamptz - `suppressed` boolean default false

### `excel_imports`

-   `id` UUID
-   `file_name` text
-   `file_type` text
-   `storage_path` text nullable
-   `worksheet_count` integer
-   `rows_read` integer
-   `rows_imported` integer
-   `new_records` integer
-   `updated_records` integer
-   `duplicate_rows` integer
-   `invalid_rows` integer
-   `status` text
-   `error_summary` text nullable
-   `imported_by` UUID nullable
-   `started_at` timestamptz
-   `completed_at` timestamptz nullable

### `excel_import_sheets`

-   `id` UUID
-   `import_id` UUID references `excel_imports`
-   `sheet_name` text
-   `rows_read` integer
-   `rows_imported` integer
-   `duplicate_rows` integer
-   `invalid_rows` integer

### `lead_sources`

-   `id` UUID
-   `lead_id` UUID references `leads`
-   `source_url` text
-   `source_name` text
-   `field_supported` text nullable
-   `evidence_note` text nullable
-   `retrieved_at` timestamptz

### `campaigns`

-   `id` UUID
-   `name` text
-   `target_description` text nullable
-   `market` text nullable
-   `channels` JSONB
-   `status` text
-   `daily_target` integer nullable
-   `start_at` timestamptz nullable
-   `end_at` timestamptz nullable
-   `created_at` timestamptz

### `outreach_drafts`

-   `id` UUID
-   `lead_id` UUID references `leads`
-   `campaign_id` UUID references `campaigns` nullable
-   `channel` text
-   `subject` text nullable
-   `message_body` text
-   `version` integer
-   `status` text
-   `evidence_snapshot` JSONB nullable
-   `created_at` timestamptz
-   `approved_at` timestamptz nullable
-   `approved_by` UUID nullable

### `outreach_events`

-   `id` UUID
-   `lead_id` UUID references `leads`
-   `campaign_id` UUID references `campaigns` nullable
-   `draft_id` UUID references `outreach_drafts` nullable
-   `channel` text
-   `event_type` text
-   `event_status` text
-   `provider_message_id` text nullable
-   `event_time` timestamptz
-   `details` JSONB nullable
-   `created_at` timestamptz

Examples of event types: `approved`, `send_attempted`, `sent`,
`delivered`, `bounced`, `reply_received`, `positive_reply`,
`negative_reply`, `opt_out`, `meeting_booked`, `failed`.

### `follow_up_tasks`

-   `id` UUID
-   `lead_id` UUID references `leads`
-   `campaign_id` UUID references `campaigns` nullable
-   `channel` text
-   `due_at` timestamptz
-   `status` text
-   `draft_id` UUID references `outreach_drafts` nullable
-   `completed_at` timestamptz nullable
-   `notes` text nullable
-   `created_at` timestamptz

### `sales_opportunities`

-   `id` UUID
-   `lead_id` UUID references `leads`
-   `title` text
-   `stage` text
-   `estimated_value` numeric nullable
-   `currency` text default `USD`
-   `expected_close_date` date nullable
-   `actual_received_amount` numeric nullable
-   `won_at` timestamptz nullable
-   `lost_reason` text nullable
-   `notes` text nullable
-   `created_at` timestamptz
-   `updated_at` timestamptz

### `suppression_list`

-   `id` UUID
-   `lead_id` UUID references `leads` nullable
-   `email_normalized` text nullable
-   `phone_normalized` text nullable
-   `social_identifier` text nullable
-   `reason` text
-   `source_event_id` UUID nullable
-   `created_at` timestamptz

### `automation_runs`

-   `id` UUID
-   `workflow_name` text
-   `external_run_id` text nullable
-   `status` text
-   `started_at` timestamptz
-   `completed_at` timestamptz nullable
-   `records_processed` integer default 0
-   `records_succeeded` integer default 0
-   `records_skipped` integer default 0
-   `error_summary` text nullable
-   `details` JSONB nullable

**Implementation note:** The developer should inspect the current
Supabase schema first and reuse or safely extend existing tables where
appropriate. Do not blindly create duplicate versions of tables that
already exist.

------------------------------------------------------------------------

## 17. Metric Definitions and Query Rules

Keep a single source of truth for each metric.

-   `total_excel_rows`: sum imported data rows using a clearly defined
    policy. Decide whether this means rows ever imported or rows in the
    current active dataset, and label it accordingly.
-   `unique_companies`: count distinct canonical company identities in
    the active leads dataset.
-   `duplicate_rows`: count import rows identified as duplicates, not
    the number of duplicate groups.
-   `verified_contacts`: count contacts whose required verification
    status is successful under the project's actual verification
    process.
-   `qualified_leads`: count leads meeting the configured score
    threshold and required data-quality checks.
-   `messages_sent`: count unique successful send events. Exclude drafts
    and failed attempts.
-   `replies_received`: count unique inbound reply events, avoiding
    duplicate webhook processing.
-   `positive_replies`: count unique replies currently classified
    positive.
-   `meetings_booked`: count meetings with a confirmed booked status.
-   `deals_won`: count sales opportunities in the won stage.
-   `won_deal_value`: sum won opportunity values.
-   `received_revenue`: sum recorded payments only. If payments are not
    tracked, do not show this as revenue received.
-   `reply_rate`: unique replied-to prospects divided by unique
    contacted prospects for the same period/channel/campaign.
-   `positive_reply_rate`: unique prospects with positive replies
    divided by unique contacted prospects.
-   `lead_to_meeting_rate`: leads with a booked meeting divided by the
    defined eligible lead cohort.
-   `win_rate`: won opportunities divided by closed opportunities (won +
    lost), not all leads.

Use timezone-aware date boundaries. Prevent double-counting when a
single prospect receives multiple messages or a provider webhook is
delivered more than once.

------------------------------------------------------------------------

## 18. Security, Privacy, and Reliability

-   Add authentication before exposing real prospect or campaign data
    publicly.
-   Use Supabase Row Level Security and appropriate authorization.
-   Never expose service-role keys or API secrets in browser code.
-   Validate file types, file sizes, and imported content.
-   Avoid executing formulas or macros from uploaded spreadsheets.
-   Escape imported values before rendering them to prevent script
    injection.
-   Do not render untrusted HTML from company websites.
-   Keep an audit trail for approval, send, edits, opt-outs, and
    deletion actions.
-   Respect applicable privacy and anti-spam laws.
-   Include unsubscribe/suppression handling for email and honor stop
    requests.
-   Do not collect or infer sensitive personal information.
-   Do not fabricate verification results, source evidence, or sales
    outcomes.
-   Handle API limits and temporary failures with bounded retries and
    backoff.
-   Use idempotency keys or deduplication for imports, provider events,
    and send operations.
-   Confirm before destructive actions.
-   Show errors in human-readable language without leaking secrets.

------------------------------------------------------------------------

## 19. MVP Scope for a 7--8 Hour Build

### Must deliver

1.  Dark orange-accented responsive layout and sidebar.
2.  Overview with actual metrics.
3.  Excel/CSV upload and import summary.
4.  Excel inventory showing files, worksheets, rows, duplicates, and
    import status.
5.  Lead database with search, filters, and lead detail.
6.  Approval queue with editable drafts and approve/reject controls.
7.  Outreach event log with per-channel sent/reply metrics.
8.  Basic sales pipeline.
9.  Basic follow-up list.
10. Empty states, loading states, error handling, and end-to-end smoke
    test.

### Only if time remains

-   Advanced chart interactions.
-   Complex custom report builder.
-   Fully automated reply sync across social platforms.
-   Advanced role/permission management.
-   Multi-step follow-up sequences.
-   Custom drag-and-drop pipeline.
-   Elaborate animations and visual effects.
-   Multi-provider discovery abstraction.

### Fallback plan

If time runs short: - Keep Google Sheets as a temporary import/review
path. - Build the database and main dashboard first. - Allow manual
outreach logging where channel integrations are not ready. - Keep
discovery provider integration modular and show a setup state if
credentials are missing. - Do not fake working integrations to make the
interface look complete.

------------------------------------------------------------------------

## 20. Suggested 8-Hour Implementation Schedule

### Hour 1 --- Project setup and schema review

-   Inspect existing repository, package manager, deployment, and
    Supabase schema.
-   Reuse working infrastructure.
-   Create/extend the required tables and secure access rules.
-   Set up the design tokens and shared components.

### Hours 2--3 --- Layout and Excel imports

-   Build sidebar, top bar, KPI cards, and responsive layout.
-   Implement Excel/CSV upload, worksheet selection, column mapping, and
    import summary.
-   Store import metadata and compute real row counts.

### Hours 4--5 --- Lead database and overview analytics

-   Build lead table, search, filters, and detail view.
-   Connect KPI cards and charts to actual queries.
-   Add Excel inventory, data quality counts, qualification chart, and
    recent activity.

### Hour 6 --- Approval queue and outreach log

-   Implement editable drafts, approval state transitions, audit events,
    and channel-based outreach log.
-   Ensure nothing sends before approval.
-   If sending integration is not ready, provide a safe manual-send
    logging workflow.

### Hour 7 --- Sales pipeline, follow-ups, and automation health

-   Build a basic stage-based sales pipeline.
-   Add follow-up tasks.
-   Display real automation run data where connected; otherwise show
    integration setup status.

### Hour 8 --- Test and stabilize

-   Test upload of a sample workbook with multiple sheets.
-   Verify totals against actual row counts.
-   Test duplicate handling, missing data, and import errors.
-   Verify KPI calculations against database records.
-   Test approval/rejection and duplicate-send prevention.
-   Test responsive layout and empty/error states.
-   Fix critical bugs before adding polish.

This schedule is aggressive. Prioritize a reliable end-to-end flow over
the number of screens completed.

------------------------------------------------------------------------

## 21. Acceptance Criteria

The MVP is acceptable when:

-   [ ] Dashboard loads without runtime errors.
-   [ ] Layout matches the dark, orange-accented reference style.
-   [ ] Sidebar navigation works.
-   [ ] Overview cards use actual saved data or honest zero/empty
    states.
-   [ ] User can upload a supported Excel/CSV file.
-   [ ] Workbook sheets and row counts are calculated from the real
    file.
-   [ ] Import summary distinguishes new, updated, duplicate, and
    invalid rows.
-   [ ] Unique company count is not simply the total row count.
-   [ ] Lead table can search and filter.
-   [ ] Source URLs and verification status are visible.
-   [ ] AI drafts are editable and require explicit approval.
-   [ ] Unapproved or suppressed contacts cannot be sent messages.
-   [ ] Outreach metrics distinguish successful sends from failed
    attempts.
-   [ ] Replies and channel activity are not fabricated.
-   [ ] Follow-up tasks can be viewed and updated.
-   [ ] Sales pipeline separates estimated deal value from actual
    received revenue.
-   [ ] Automation errors are visible where data is available.
-   [ ] No secret keys are exposed in client-side code.
-   [ ] Mobile layout is usable.
-   [ ] End-to-end smoke test passes.

------------------------------------------------------------------------

## 22. Developer Instructions

1.  Start by inspecting the existing codebase and current Supabase
    schema.
2.  Do not rebuild working infrastructure or remove existing features.
3.  If a repository already exists, preserve its conventions and package
    manager.
4.  Use reusable components for KPI cards, data tables, status badges,
    filters, and charts.
5.  Keep metric calculations in shared query/service functions instead
    of duplicating formulas across pages.
6.  Keep database access and secrets server-side where required.
7.  Use migrations for schema changes.
8.  Add clear loading, empty, and error states.
9.  Do not use hardcoded production metrics or fake success indicators.
10. If a required API is not configured, show a clear setup message and
    keep the rest of the app usable.
11. Test the complete workflow before claiming it works.
12. At the end, provide:
    -   What was implemented
    -   What is working end to end
    -   What remains incomplete
    -   Required environment variables/integrations
    -   How to run locally
    -   How to deploy
    -   Any database migration steps
    -   Test results and known limitations

## Final Product Goal

Deliver a polished, dark analytics command center that accurately shows
**how much data exists across all Excel sheets**, how many unique and
qualified HVAC prospects are available, how outreach is performing by
channel, and how many real conversations and deals are being generated.

The product must be useful on day one, honest about what is and is not
connected, and structured so that automated discovery and outreach can
be expanded without rebuilding the dashboard.
