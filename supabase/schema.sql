-- ============================================================
-- World Cup Tier Pool — Supabase schema
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- ============================================================

-- A single key/value table backs the whole app. Keys look like:
--   entry:<name-slug>   -> one player's picks (JSON)
--   results             -> the commissioner's per-team results (JSON)
--   settings            -> lock state + Golden Boot winner (JSON)
create table if not exists public.kv (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.kv enable row level security;

-- ------------------------------------------------------------
-- Access policies
-- ------------------------------------------------------------
-- This is a friendly pool, so we let anyone with the site (the public anon
-- key) read and write the kv table. The "commissioner" gate is handled in the
-- app UI with a passcode — it is convenience, not hard security.
--
-- If you'd rather lock down writes, delete the write policies below and use
-- the Supabase service role from a trusted environment instead. For a friend
-- group, the open policy is usually fine.

drop policy if exists "kv public read" on public.kv;
create policy "kv public read"
  on public.kv for select
  using (true);

drop policy if exists "kv public insert" on public.kv;
create policy "kv public insert"
  on public.kv for insert
  with check (true);

drop policy if exists "kv public update" on public.kv;
create policy "kv public update"
  on public.kv for update
  using (true)
  with check (true);

drop policy if exists "kv public delete" on public.kv;
create policy "kv public delete"
  on public.kv for delete
  using (true);
