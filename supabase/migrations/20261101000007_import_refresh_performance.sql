-- LeadPilot AI — make import duplicate checking scale linearly
-- Found by live testing the import module (Supabase, signed-in user, 8 s
-- statement timeout): refresh_excel_import() on freshly staged rows timed out
-- at 5,000 rows. Two causes, both fixed here without changing any rule,
-- result, permission or table:
--
-- 1. The duplicate query joined its own CTE back to itself to find the id of
--    the first matching row. Freshly inserted rows have no planner statistics,
--    so Postgres estimated ~1 row and chose a nested loop: O(n^2). The id is
--    now carried through the window functions, so there is no self-join.
-- 2. import_rows_normalize ran on every UPDATE, recomputing six regex
--    normalizations for each row the check flags. It now runs only on INSERT
--    and when mapped_data is updated (the only input it reads), which is the
--    only time the keys can change.
--
-- Duplicate rules are unchanged: an earlier row (sheet order, then row number)
-- with the same normalized domain, email, phone, or company name + city +
-- state. Company name alone never matches.

create or replace function private.refresh_excel_import_counts(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with ordered as (
    select r.id, r.status, r.duplicate_of_row_id,
           r.normalized_domain d, r.normalized_email e, r.normalized_phone p,
           case
             when r.normalized_company_name is not null and r.normalized_city is not null
                  and r.normalized_state is not null
             then pg_catalog.jsonb_build_array(r.normalized_company_name, r.normalized_city, r.normalized_state)
           end as cl,
           row_number() over (order by s.sheet_index, r.row_number) as pos
    from public.import_rows r
    join public.excel_import_sheets s on s.id = r.sheet_id
    where r.import_id = p_import_id
      and s.selected
      and r.status in ('valid', 'duplicate', 'imported')
  ),
  -- First occurrence (position and id) per key; null when the row lacks the key.
  firsts as (
    select id, pos, status, duplicate_of_row_id,
           case when d is not null then first_value(pos) over w_d end as pd,
           case when d is not null then first_value(id) over w_d end as id_d,
           case when e is not null then first_value(pos) over w_e end as pe,
           case when e is not null then first_value(id) over w_e end as id_e,
           case when p is not null then first_value(pos) over w_p end as pp,
           case when p is not null then first_value(id) over w_p end as id_p,
           case when cl is not null then first_value(pos) over w_c end as pc,
           case when cl is not null then first_value(id) over w_c end as id_c
    from ordered
    window w_d as (partition by d order by pos),
           w_e as (partition by e order by pos),
           w_p as (partition by p order by pos),
           w_c as (partition by cl order by pos)
  ),
  decided as (
    select id, status, duplicate_of_row_id,
           least(pd, pe, pp, pc) < pos as is_dup,
           case least(pd, pe, pp, pc)
             when pd then id_d when pe then id_e when pp then id_p when pc then id_c
           end as first_id
    from firsts
  )
  update public.import_rows r
  set status = case when x.is_dup then 'duplicate' else 'valid' end,
      duplicate_of_row_id = case when x.is_dup then x.first_id end
  from decided x
  where r.id = x.id
    and x.status in ('valid', 'duplicate')
    and (x.status, x.duplicate_of_row_id) is distinct from
        (case when x.is_dup then 'duplicate' else 'valid' end,
         case when x.is_dup then x.first_id end);

  update public.excel_import_sheets s
  set rows_read = c.rows_read,
      rows_imported = c.rows_imported,
      duplicate_rows = c.duplicate_rows,
      invalid_rows = c.invalid_rows
  from (
    select s2.id,
           count(r.id)::int as rows_read,
           count(r.id) filter (where r.status = 'imported')::int as rows_imported,
           count(r.id) filter (where r.status = 'duplicate')::int as duplicate_rows,
           count(r.id) filter (where r.status = 'invalid')::int as invalid_rows
    from public.excel_import_sheets s2
    left join public.import_rows r on r.sheet_id = s2.id
    where s2.import_id = p_import_id
    group by s2.id
  ) c
  where s.id = c.id;

  update public.excel_imports i
  set worksheet_count = c.worksheet_count,
      rows_read = c.rows_read,
      rows_imported = c.rows_imported,
      duplicate_rows = c.duplicate_rows,
      invalid_rows = c.invalid_rows,
      failed_rows = c.failed_rows
  from (
    select count(distinct s.id)::int as worksheet_count,
           count(r.id) filter (where s.selected)::int as rows_read,
           count(r.id) filter (where s.selected and r.status = 'imported')::int as rows_imported,
           count(r.id) filter (where s.selected and r.status = 'duplicate')::int as duplicate_rows,
           count(r.id) filter (where s.selected and r.status = 'invalid')::int as invalid_rows,
           count(r.id) filter (where s.selected and r.status = 'failed')::int as failed_rows
    from public.excel_import_sheets s
    left join public.import_rows r on r.sheet_id = s.id
    where s.import_id = p_import_id
  ) c
  where i.id = p_import_id;
end;
$$;

-- CREATE OR REPLACE keeps the existing owner and grants; restated for clarity.
revoke execute on function private.refresh_excel_import_counts(uuid) from public, anon, authenticated;

drop trigger import_rows_normalize on public.import_rows;
create trigger import_rows_normalize
  before insert or update of mapped_data on public.import_rows
  for each row execute function private.import_row_normalize();
