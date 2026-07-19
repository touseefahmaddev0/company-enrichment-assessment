export type EnrichmentStatus = "pending" | "enriching" | "enriched" | "failed";

// The raw company row (matches supabase/migrations/0001_init.sql).
export interface Company {
  id: string;
  name: string;
  domain: string | null;
  raw_note: string | null;
  created_at: string;
  status: EnrichmentStatus;
  last_enriched_at: string | null;
  last_error: string | null;
  attempt_count: number;
  owner_id: string | null;
}

// Keep in sync with the contract in supabase/functions/enrich/llm.ts and the
// enrichment_results table.
export interface EnrichmentResult {
  company_id: string;
  industry: string;
  employee_size_bucket: string;
  hq_country: string;
  one_line_summary: string;
  confidence: number;
  // Provenance: which provider/model produced this row.
  source: string;
  model: string | null;
  updated_at: string;
}
