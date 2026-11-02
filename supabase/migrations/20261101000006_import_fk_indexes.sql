-- LeadPilot AI — covering indexes for the composite import foreign keys
-- Supabase Performance Advisor (0001 unindexed_foreign_keys) flagged three FKs
-- from migration 005 whose columns are not the leading columns of any index:
--   excel_import_sheets (workspace_id, import_id) -> excel_imports (workspace_id, id)
--   import_rows         (workspace_id, import_id) -> excel_imports (workspace_id, id)
--   import_rows         (import_id, sheet_id)     -> excel_import_sheets (import_id, id)
-- Each is ON DELETE CASCADE, so deleting an import (or sheet) must find its child
-- rows by exactly these columns; import_rows can hold tens of thousands of rows
-- per import. Existing indexes lead with other columns, so none is reused.
--
-- Not included: workspaces.created_by -> auth.users (ON DELETE SET NULL). The
-- table holds one row per tenant and auth users are rarely deleted, so a
-- sequential scan there costs nothing measurable; an index would only add writes.
--
-- Index-only migration: no tables, data, policies, grants or functions change.
-- The tables are small at this stage, so plain CREATE INDEX (inside the
-- migration transaction) holds its lock only briefly.

create index excel_import_sheets_workspace_import_idx
  on public.excel_import_sheets (workspace_id, import_id);

create index import_rows_workspace_import_idx
  on public.import_rows (workspace_id, import_id);

create index import_rows_import_sheet_idx
  on public.import_rows (import_id, sheet_id);
