-- =============================================================================
-- 0001_init.sql
-- The `companies` table is provided. Everything below it is yours to design.
-- =============================================================================

create extension if not exists pgcrypto;

-- Raw, messy input rows (mirrors companies_seed.json). This part is DONE.
create table if not exists public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  domain             text,
  raw_note           text,
  created_at         timestamptz not null default now(),
  -- Enrichment lifecycle. 'enriching' lets the UI show a spinner and guards
  -- against double-triggering a re-run while a call is in flight.
  status             text not null default 'pending'
                       check (status in ('pending', 'enriching', 'enriched', 'failed')),
  last_enriched_at   timestamptz,
  -- RLS ownership. NULL = shared/org-wide data (e.g. the bulk-loaded seed);
  -- a concrete owner_id is private to that user. See RLS section below.
  owner_id           uuid references auth.users(id)
);


-- ENRICHMENT RESULTS -----------------------------------------------------------
-- One row per company (upsert on re-run), not append-only/versioned: the
-- dashboard only ever needs the latest enrichment, and an upsert keeps the
-- write path simple. A separate append-only/per-field audit table is the
-- stretch alternative (see README) and is deliberately not implemented here.
-- Provenance is recorded per-row via `source`/`model`, not per-field.
create table public.enrichment_results (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  industry              text not null,
  employee_size_bucket  text not null
                          check (employee_size_bucket in ('1-50', '51-200', '201-1000', '1001-5000', '5000+')),
  hq_country            text not null,
  one_line_summary      text not null check (char_length(one_line_summary) <= 160),
  confidence            numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  -- Provenance: which provider/model produced this row, e.g. 'mock',
  -- 'openai:gpt-4o-mini'. `source` is the high-level channel, `model` the
  -- specific model id/version (kept separate since a provider can have several).
  source                text not null,
  model                 text,
  -- Raw provider response, kept for debugging/audit without shaping the schema.
  raw_response          jsonb,
  updated_at            timestamptz not null default now()
);

-- Last error + attempt count live on `companies`, not `enrichment_results`:
-- a failed attempt has no valid enrichment to store a row for, and the
-- companies row is what the dashboard's status column already reads from.
alter table public.companies
  add column last_error text,
  add column attempt_count int not null default 0;


-- INDEXES ----------------------------------------------------------------------
-- pg_trgm backs trigram GIN indexes so the dashboard's free-text filter
-- (`ILIKE '%term%'` across name/raw_note) stays index-assisted at ~100k rows
-- instead of falling back to a sequential scan — a plain btree can't help
-- with a leading-wildcard ILIKE.
create extension if not exists pg_trgm;

-- Status filter/column on the dashboard, and the status check the Edge
-- Function does before re-running (skip if already 'enriching').
create index companies_status_idx on public.companies (status);

-- RLS predicate is `owner_id is null or owner_id = auth.uid()`; this index
-- keeps that filter cheap once rows have real owners.
create index companies_owner_id_idx on public.companies (owner_id);

-- Free-text filter target columns.
create index companies_name_trgm_idx on public.companies using gin (lower(name) gin_trgm_ops);
create index companies_raw_note_trgm_idx on public.companies using gin (lower(raw_note) gin_trgm_ops);

-- Default dashboard sort (newest first) paired with offset pagination.
create index companies_created_at_idx on public.companies (created_at desc);


-- ROW LEVEL SECURITY -------------------------------------------------------------
-- Isolation model: owner_id NULL = shared/org-wide (the bulk-loaded seed and
-- anything created without a logged-in user), visible to everyone including
-- anon. owner_id = a real user = private to that user. This lets the
-- dashboard keep working over the anon key with no login UI wired up, while
-- still giving genuine per-user isolation for rows that do have an owner.
-- Full reasoning + a two-user test recipe are in the README.
--
-- The Edge Function writes with the SERVICE ROLE key, which BYPASSES RLS —
-- that's intentional: it's the trusted server-side path that persists
-- enrichment results after validating them.
alter table public.companies enable row level security;
alter table public.enrichment_results enable row level security;

create policy "companies_select_own_or_shared"
  on public.companies for select
  using (owner_id is null or owner_id = auth.uid());

-- Not currently exercised by the frontend (it never inserts companies), but
-- included so the write side of the policy isn't left undefined: a user can
-- only ever create rows they themselves own.
create policy "companies_insert_own"
  on public.companies for insert
  to authenticated
  with check (owner_id = auth.uid());

-- enrichment_results has no owner_id of its own; isolation is derived by
-- joining back to the parent company's ownership.
create policy "enrichment_results_select_via_company"
  on public.enrichment_results for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = enrichment_results.company_id
        and (c.owner_id is null or c.owner_id = auth.uid())
    )
  );
