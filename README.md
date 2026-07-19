# Company Enrichment — Touseef Ahmad

> This is a template. Please fill it in as part of the exercise — we read it carefully.
> Start with `TASK.md` for the full brief.

## How to run

Prerequisites: Node 18+, Docker Desktop running, [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1) Start local Supabase (Postgres, Auth, Edge runtime).
supabase start
# note the printed API URL, anon key, and service_role key

# 2) Apply migrations + load the seed. supabase/seed.sql runs automatically
#    after a reset, so this single command gets you a fully-seeded DB.
supabase db reset

# 3) Serve the Edge Function with the mock LLM provider (no API key needed).
cp .env.example .env
# edit .env: set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from step 1,
# LLM_PROVIDER=mock
supabase functions serve enrich --env-file ./.env

# 4) Run the web app.
cd web
cp .env.example .env
# edit web/.env: set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from step 1
npm install
npm run dev
```

Open the printed local URL. The table should list the 15 seed companies, all `pending`;
clicking "Run" on a row calls the Edge Function (mock provider) and the status/detail
panel update once it resolves.

Run the Edge Function unit tests (validation + retry/fallback):

```bash
deno test --allow-env supabase/functions/enrich/llm.test.ts
```

**Verification note:** Docker/the Supabase CLI weren't available in the environment this
was built in, so this was built and reviewed statically (TypeScript build, reading the SQL
top-to-bottom, tracing the retry/fallback logic by hand) plus the Deno unit tests above —
I did not personally run `supabase start` / `db reset` / `functions serve` / `npm run dev`
end-to-end. Please flag anything that doesn't come up cleanly.

## Architecture overview

```
companies_seed.json ──(supabase/seed.sql, on `db reset`)──> companies (status='pending')
                                                                   │
                                            user clicks Run/Re-run │ (web/src/api/companies.ts
                                                                   ▼  triggerEnrich)
                                                    supabase.functions.invoke("enrich")
                                                                   │
                                     Edge Function (supabase/functions/enrich/index.ts):
                                       1. validate Authorization header
                                       2. fetch company (service-role client, bypasses RLS)
                                       3. status -> 'enriching'
                                       4. enrichWithRetryAndFallback() (llm.ts):
                                            - call provider, validateEnrichment() (zod)
                                            - retry up to 2x on the primary provider
                                            - fall back to FALLBACK_LLM_PROVIDER (default mock)
                                            - throws EnrichmentFailedError if both exhausted
                                       5a. success -> upsert enrichment_results,
                                           companies.status = 'enriched'
                                       5b. failure -> companies.status = 'failed' + last_error
                                                   (no enrichment_results row written)
                                                                   │
                                                                   ▼
                              web dashboard (App.tsx) refetches the page -> CompaniesTable
                              shows the new status; CompanyDetail fetches enrichment_results
                              for the selected row and shows each field + source/model/confidence.
```

The frontend never writes to `companies` or `enrichment_results` directly — it only reads
(via the anon key, subject to RLS) and triggers the Edge Function, which is the sole writer
(via the service-role key, which bypasses RLS by design).

## Key decisions & trade-offs

- **One `enrichment_results` row per company, upserted on re-run** — not append-only/versioned.
  The dashboard only ever needs the latest result, and an upsert keeps the write path simple.
  A separate append-only/per-field audit table (a row per produced field, with full history)
  is the natural next step if we need to answer "what did we know about this company last
  Tuesday" or diff enrichments over time — I left it out to keep the core solid within the
  time box (see `TASK.md`'s stretch list).
- **Provenance is per-row (`source`/`model`), not per-field.** A single enrichment call
  produces all five fields together from one model response, so today they share one
  provenance record. Per-field provenance only pays off once fields can come from different
  passes/sources (e.g. a cheap heuristic for `hq_country`, an LLM for `one_line_summary`) —
  not the case here.
- **Status lives on `companies`, not `enrichment_results`**: a failed attempt has nothing
  valid to attach a result row to, and the companies row is what the dashboard's status
  column and filter already read from. `last_error` / `attempt_count` live there too, for
  the same reason.
- **Retry (2x primary) + fallback (1x, default `mock`), never partial writes.**
  `validateEnrichment` is the single gate between the model and the database — nothing that
  fails it is ever persisted. See "LLM reliability" below.
- **Offset pagination via `.range()`**, per the TODO's own hint. This is simple and fine for
  ~100k rows at shallow-to-moderate page depths (backed by the `created_at desc` index). Very
  deep pages (`OFFSET 90000`) do get slower since Postgres still has to walk past the skipped
  rows — the standard fix is keyset pagination (`WHERE created_at < :last_seen ORDER BY
  created_at DESC LIMIT :n`), which I didn't implement to keep the one-day scope tight, but
  it's a drop-in swap in `listCompanies` if deep pages become a real usage pattern.
- **Free-text filter via `ILIKE` + `pg_trgm` GIN indexes**, not Postgres full-text search
  (`tsvector`). `ILIKE '%term%'` matches substrings mid-word (e.g. "sie" inside "Siemens"),
  which felt closer to what a "filter box" user expects than full-text search's whole-lexeme
  matching — and it's what the TODO explicitly hinted at (`.ilike()`).
- **The auth "seam" is deliberately shallow** (see LLM reliability / RLS sections) — no login
  UI was in scope this round, so I didn't want to fake a session model that doesn't exist yet.

## RLS model

**Isolation rule:** `companies.owner_id` is nullable.
- `owner_id IS NULL` → shared/org-wide data (the bulk-loaded seed, or anything created without
  a logged-in user). Visible to everyone, including `anon`.
- `owner_id = <uuid>` → private to that user.

```sql
create policy "companies_select_own_or_shared"
  on public.companies for select
  using (owner_id is null or owner_id = auth.uid());
```

`enrichment_results` has no `owner_id` of its own — its `select` policy joins back to the
parent company's ownership:

```sql
create policy "enrichment_results_select_via_company"
  on public.enrichment_results for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = enrichment_results.company_id
        and (c.owner_id is null or c.owner_id = auth.uid())
    )
  );
```

I also added a forward-looking `insert` policy (`with check (owner_id = auth.uid())`) even
though the current frontend never inserts companies — it's the write-side half of the same
model, so a real "add a company" feature later has an isolation rule to slot into instead of
inheriting an open table.

**Why this shape:** the brief explicitly said wiring real auth end-to-end is a stretch, not
required — but I still wanted RLS that does real per-user isolation, not just a role gate
("authenticated vs anon") that would isolate nothing. Treating `NULL` as "shared" is what
lets both things be true at once: the anon-key dashboard keeps working against the seed data
with zero login UI, while two authenticated users who *do* create their own rows genuinely
cannot see each other's.

The Edge Function's Postgres client uses the **service-role key**, which bypasses RLS
entirely — that's intentional and is why validation happens in the function itself rather
than being enforced at the database layer.

**How I'd test it with two users** (no login UI, so this is a `psql`/API-level test):

```sql
-- 1. Create two users (Supabase Auth admin API, or via the Studio UI at
--    http://127.0.0.1:54323 -> Authentication -> Add user). Note their UUIDs.

-- 2. Insert a private company for each, as that user, e.g. via psql with role impersonation:
set local role authenticated;
set local request.jwt.claims = '{"sub": "<user-a-uuid>"}';
insert into public.companies (name, owner_id) values ('User A Co', '<user-a-uuid>');

set local request.jwt.claims = '{"sub": "<user-b-uuid>"}';
insert into public.companies (name, owner_id) values ('User B Co', '<user-b-uuid>');
reset role;

-- 3. Query as user A and confirm isolation:
set local role authenticated;
set local request.jwt.claims = '{"sub": "<user-a-uuid>"}';
select name from public.companies; -- should include the 15 shared seed rows + "User A Co",
                                    -- but NOT "User B Co"
reset role;
```

Equivalently over HTTP: sign in as each user via `supabase.auth.signInWithPassword`, grab
their `access_token`, and send it as the `Authorization: Bearer <token>` header on a
PostgREST `GET /rest/v1/companies` call — same expected result.

## LLM reliability

**Structured output:** `ENRICHMENT_JSON_SCHEMA` in `llm.ts` is the contract (meant to be
handed to a real provider's structured-output/function-calling API). `validateEnrichment`
mirrors it exactly with a `zod` schema — `.strict()` (rejects unknown keys, matching
`additionalProperties: false`), the exact enum for `employee_size_bucket`, `maxLength(160)`
on the summary, and a `[0, 1]` range on `confidence`. Nothing that fails this check ever
reaches a `.insert()`/`.upsert()` call.

**What happens when the model misbehaves** (`enrichWithRetryAndFallback` in `llm.ts`):
1. Call the primary provider (`LLM_PROVIDER` env var), validate the result.
2. On any failure (bad JSON, wrong enum, out-of-range confidence, thrown network error),
   retry up to 2 attempts total against the primary provider.
3. If both attempts fail, try `FALLBACK_LLM_PROVIDER` (default `mock`, which is always
   structurally valid) once.
4. If that also fails, throw `EnrichmentFailedError` — the handler catches this, sets
   `companies.status = 'failed'` + `last_error` + `attempt_count`, and **writes no
   `enrichment_results` row**. The dashboard shows "Failed" with the error message in the
   detail panel; re-running is just clicking "Re-run" again.

`enrichWithLLM` takes an `attempt` number specifically so a real provider implementation can
tighten its prompt/lower temperature on retries — the mock provider ignores it since it's
already deterministic.

**Auth on the Edge Function:** no login UI exists yet, and the frontend calls the function
with only the anon key (no user session). So "authenticated" is defined pragmatically: the
`Authorization` header must be a syntactically valid, unexpired JWT (3 dot-separated
segments, `exp` in the future) — enough to reject missing/garbage/expired headers without
rejecting the anon-key calls the app actually makes. This does **not** verify the signature
or that the token belongs to a real user session — once login exists, swap this for
`supabase.auth.getUser(token)` against an anon-key client and require a real user id.

**Real OpenAI/Mistral implementation:** left as `throw new Error("not implemented")` per
provider — the scope decision here (see next section) was to spend the time on retry/
fallback/validation/persistence reliability rather than a real API call, since that's what
the brief said matters most. Wiring a real call is mechanical from here: call the provider
with `ENRICHMENT_JSON_SCHEMA` as the structured-output/tool schema, return the parsed JSON
from `enrichWithLLM`, and the existing retry/fallback/validation path handles the rest
unchanged.

## Cost / latency notes

Rough estimates for enriching 10,000 companies with a real provider (e.g.
`gpt-4o-mini`-class model), assuming ~150 input tokens (name + note) and ~80 output tokens
per call, one call per company on the happy path:

- **Cost:** at ~$0.15/1M input + $0.60/1M output tokens (representative small-model
  pricing), that's roughly `10,000 × (150 × $0.15 + 80 × $0.60) / 1,000,000 ≈ $0.70` for the
  happy path. Retries/fallbacks add a small multiplier — even a pessimistic 20% retry rate
  keeps this under $1 for 10k companies. The real cost driver at this model tier is API
  request overhead and latency, not tokens.
- **Latency:** if the Edge Function calls the provider synchronously per company (as it does
  today), sequential enrichment of 10k companies at ~1s/call is ~2.7 hours. That's the
  reason a real batch run should **not** call this function in a tight loop — see below.
- **How I'd reduce it at scale:**
  - **Batch/concurrency:** fan out N requests concurrently (provider rate limits permitting)
    instead of one Edge Function invocation at a time — this is exactly what the n8n stretch
    workflow would orchestrate (batches + concurrency limit + retry/backoff + a dead-letter
    path for permanent failures).
  - **Batch APIs:** OpenAI's/Mistral's batch endpoints (~50% cheaper, no rate-limit pressure)
    are a good fit here since enrichment doesn't need to be synchronous from the user's
    perspective — a "Run" click could enqueue rather than block.
  - **Cache on `domain`:** many companies share a domain across dedup/re-import cycles (the
    seed itself has near-duplicate rows, e.g. "Siemens AG" / "siemens"); skipping
    re-enrichment for a domain enriched in the last N days avoids paying for it twice.
  - **Cheaper model for the bulk pass:** the fields asked for here (industry, size bucket, HQ
    country, one-line summary) don't need a frontier model; a smaller/cheaper model handles
    this well, reserving a stronger model only for rows that fail validation repeatedly.

## What I deliberately left out / would do next

Cut for the one-day scope (all noted as stretch in `TASK.md`):
- Real OpenAI/Mistral API calls — mock provider only, hardened for reliability instead
  (see "LLM reliability").
- A real login UI wired to the RLS policy — the policy and a SQL-level two-user test recipe
  are done (see "RLS model"), but there's no sign-in screen exercising it live in the app.
- A separate append-only/per-field provenance (audit) table — provenance is per-row today.
- An n8n batch-orchestration workflow, and a materialized view backing a dashboard stat.
- Keyset pagination for very deep pages (offset pagination is fine at the depths a 25-per-
  page dashboard actually reaches).

What I'd build next, roughly in priority order: a real provider implementation behind the
existing retry/fallback path; keyset pagination once/if page depth becomes a real pattern;
the append-only provenance table if we need historical/diffable enrichment data; then the
n8n batch workflow for bulk (re-)enrichment runs.
