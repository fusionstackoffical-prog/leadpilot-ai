-- LeadPilot AI — backfill profiles for auth users created before the foundation migration.
-- The on_auth_user_created trigger only covers new sign-ups; this covers existing ones.
-- Idempotent: inserts only missing rows and never updates existing profiles.

insert into public.profiles (id, email, full_name)
select
  u.id,
  coalesce(u.email, ''),
  nullif(trim(u.raw_user_meta_data ->> 'full_name'), '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
