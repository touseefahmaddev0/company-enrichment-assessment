import { supabase } from "../lib/supabase";
import type { Company, EnrichmentResult } from "../types";

export interface ListParams {
  page: number; // 1-based
  pageSize: number;
  search?: string;
}

export interface ListResult {
  rows: Company[];
  total: number;
}

// `.or()` treats commas/parens as filter-list syntax, so strip them (along
// with `%`, which would otherwise let a user inject their own ILIKE
// wildcards) before interpolating user input into the filter string.
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%,()]/g, "").trim();
}

// Server-side pagination + free-text filter: `.range()` + `.select("*", {
// count: "exact" })` fetch only the current page while still returning the
// total row count, and `.or(...ilike...)` pushes the text filter down to
// Postgres (backed by the trigram indexes in the migration) instead of
// filtering ~100k rows in the browser.
export async function listCompanies(params: ListParams): Promise<ListResult> {
  const { page, pageSize, search } = params;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("companies")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  const term = search ? sanitizeSearchTerm(search) : "";
  if (term) {
    query = query.or(`name.ilike.%${term}%,raw_note.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  return { rows: (data ?? []) as Company[], total: count ?? 0 };
}

export async function getEnrichment(companyId: string): Promise<EnrichmentResult | null> {
  const { data, error } = await supabase
    .from("enrichment_results")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return (data as EnrichmentResult | null) ?? null;
}

export async function triggerEnrich(companyId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("enrich", { body: { companyId } });
  if (error) throw error;
}
