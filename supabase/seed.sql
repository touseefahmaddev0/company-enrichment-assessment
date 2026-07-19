-- =============================================================================
-- seed.sql
-- Run automatically by `supabase db reset` (and `supabase start` on first init).
-- Mirrors companies_seed.json 1:1, deliberately keeping the messy data as-is
-- (mixed casing, leading whitespace, "duplicate?" rows) — cleanup is a display
-- concern (see CompanyDetail/CompaniesTable trimming), not a seed-time fix.
-- Empty-string domains ("") are normalized to NULL since that's a data-entry
-- artifact, not meaningful content.
-- owner_id is left NULL: this is org-wide seed data, visible to everyone
-- under the RLS policy in 0001_init.sql.
-- =============================================================================

insert into public.companies (name, domain, raw_note) values
  ('Siemens AG',       'siemens.com',      'Large industrial/tech conglomerate, Munich. ~300k employees worldwide.'),
  ('siemens',          null,               'duplicate? munich electronics'),
  ('  Zalando SE',     'zalando.de',       'online fashion retailer berlin'),
  ('DB Schenker',      null,               'Logistics arm of Deutsche Bahn. HQ Essen.'),
  ('N26 GmbH',         'n26.com',          'mobile bank / fintech, Berlin, a few thousand staff'),
  ('Trumpf',           'trumpf.com',       'machine tools + lasers, family-owned, Ditzingen'),
  ('About You',        'aboutyou.com',     'Hamburg e-commerce, fashion'),
  ('Celonis',          'celonis.com',      'process mining software, Munich/NYC, unicorn'),
  ('Personio',         null,               'HR software for SMEs, München'),
  ('BioNTech SE',      'biontech.de',      'Mainz biotech, mRNA, ~5000 ppl'),
  ('flixbus',          'flixbus.com',      'FlixMobility - buses + trains, Munich'),
  ('GetYourGuide',     'getyourguide.com', 'travel experiences marketplace, Berlin'),
  ('Robert Bosch GmbH','bosch.com',        'engineering + tech, Gerlingen, very large'),
  ('DeepL',            'deepl.com',        'AI translation, Köln'),
  ('Winterhalter',     null,               'commercial dishwashing systems, Meckenbeuren - mittelstand');
