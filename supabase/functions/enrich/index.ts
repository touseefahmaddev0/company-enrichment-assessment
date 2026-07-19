// =============================================================================
// Edge Function: enrich
// Validates the Authorization header, fetches the company (service-role
// client, bypasses RLS), runs enrichWithRetryAndFallback (llm.ts — retries
// the primary provider, falls back, never returns unvalidated data), then
// persists the result + status + provenance. On total failure, marks the
// company 'failed' with the error instead of writing a partial/invalid row.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { EnrichmentFailedError, enrichWithRetryAndFallback } from "./llm.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Auth ------------------------------------------------------------------
    // No login UI is wired up (the frontend calls this with only the anon key),
    // so "authenticated" is defined pragmatically: the Authorization header must
    // carry a syntactically valid, unexpired Supabase-issued JWT (which the anon
    // key itself is). This rejects missing/garbage/expired tokens without
    // requiring a real user session — see README for the full-session version
    // you'd want once login exists.
    const authHeader = req.headers.get("Authorization");
    if (!isLikelyValidJwt(authHeader)) {
      return json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const { companyId } = await req.json().catch(() => ({}));
    if (!companyId) return json({ error: "companyId is required" }, 400);

    // Service-role client: BYPASSES RLS on purpose (trusted server-side writes).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: company, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();
    if (error || !company) return json({ error: "Company not found" }, 404);

    if (company.status === "enriching") {
      return json({ error: "Enrichment already in progress for this company" }, 409);
    }

    await supabase.from("companies").update({ status: "enriching" }).eq("id", companyId);

    // --- Enrich + persist --------------------------------------------------
    // enrichWithRetryAndFallback never returns unvalidated data — it either
    // resolves with something that passed validateEnrichment(), or throws
    // EnrichmentFailedError once retry + fallback are both exhausted.
    try {
      const outcome = await enrichWithRetryAndFallback(company);

      const { error: upsertError } = await supabase
        .from("enrichment_results")
        .upsert(
          {
            company_id: companyId,
            ...outcome.result,
            source: outcome.source,
            model: outcome.model,
            raw_response: outcome.raw,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id" },
        );
      if (upsertError) throw upsertError;

      await supabase
        .from("companies")
        .update({
          status: "enriched",
          last_enriched_at: new Date().toISOString(),
          last_error: null,
          attempt_count: outcome.attempts,
        })
        .eq("id", companyId);

      return json({
        ok: true,
        companyId,
        enrichment: outcome.result,
        source: outcome.source,
        model: outcome.model,
        attempts: outcome.attempts,
      });
    } catch (e) {
      const attempts = e instanceof EnrichmentFailedError ? e.attempts : 0;
      const message = e instanceof Error ? e.message : String(e);

      await supabase
        .from("companies")
        .update({ status: "failed", last_error: message, attempt_count: attempts })
        .eq("id", companyId);

      return json({ ok: false, companyId, error: message }, 422);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Structural + expiry check only — this does NOT verify the signature (that
// requires the project JWT secret) or that the token belongs to a real user
// session. It's enough to reject missing/garbage/expired headers while still
// accepting the anon key the frontend actually sends. See README.
function isLikelyValidJwt(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
