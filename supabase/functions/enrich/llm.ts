// =============================================================================
// LLM enrichment: the contract is defined, and a MOCK provider is implemented so
// you can build and run the whole pipeline with no API key.
// Implementing the real OpenAI/Mistral call is welcome but optional — what we
// really want to see is reliable, validated, structured output.
// =============================================================================
import { z } from "npm:zod@^3.23.8";

export type EmployeeSizeBucket =
  | "1-50" | "51-200" | "201-1000" | "1001-5000" | "5000+";

// The structured shape every enrichment must conform to.
export interface EnrichmentResult {
  industry: string;
  employee_size_bucket: EmployeeSizeBucket;
  hq_country: string;
  one_line_summary: string;
  confidence: number; // 0..1
}

export interface CompanyInput {
  id: string;
  name: string;
  domain: string | null;
  raw_note: string | null;
}

// Hand this to OpenAI/Mistral structured-output / function-calling APIs.
export const ENRICHMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["industry", "employee_size_bucket", "hq_country", "one_line_summary", "confidence"],
  properties: {
    industry: { type: "string" },
    employee_size_bucket: { type: "string", enum: ["1-50", "51-200", "201-1000", "1001-5000", "5000+"] },
    hq_country: { type: "string" },
    one_line_summary: { type: "string", maxLength: 160 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const PROVIDER = Deno.env.get("LLM_PROVIDER") ?? "mock";

// `attempt` is threaded through so a real provider implementation can tighten
// its prompt (e.g. re-emphasize the schema, lower temperature) on retries.
// The mock provider ignores it — it's deterministic either way.
export async function enrichWithLLM(
  company: CompanyInput,
  provider: string = PROVIDER,
  attempt = 1,
): Promise<unknown> {
  switch (provider) {
    case "openai":
      // TODO(candidate): real OpenAI call using structured outputs +
      // ENRICHMENT_JSON_SCHEMA. Read the key from OPENAI_API_KEY.
      throw new Error("LLM_PROVIDER=openai not implemented yet");
    case "mistral":
      // TODO(candidate): real Mistral call using structured outputs.
      throw new Error("LLM_PROVIDER=mistral not implemented yet");
    case "mock":
    default:
      return mockEnrich(company, attempt);
  }
}

// Placeholder model ids for providers that aren't implemented yet, so
// provenance is still meaningful once they are.
function modelIdFor(provider: string): string | null {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "mistral":
      return "mistral-small-latest";
    default:
      return null;
  }
}

// Deterministic, plausible output so the pipeline runs end-to-end without a key.
function mockEnrich(company: CompanyInput, _attempt: number): EnrichmentResult {
  const note = (company.raw_note ?? "").toLowerCase();

  const bucket: EmployeeSizeBucket =
    note.includes("300k") || note.includes("very large") ? "5000+"
    : note.includes("5000") ? "1001-5000"
    : note.includes("few thousand") ? "201-1000"
    : "51-200";

  const industry =
    note.includes("bank") || note.includes("fintech") ? "Financial Services"
    : note.includes("fashion") || note.includes("retail") || note.includes("e-commerce") ? "Retail / E-commerce"
    : note.includes("software") || note.includes("ai") || note.includes("mining") ? "Software"
    : note.includes("logistics") ? "Logistics"
    : note.includes("biotech") || note.includes("mrna") ? "Biotech"
    : "Unknown";

  return {
    industry,
    employee_size_bucket: bucket,
    hq_country: "Germany",
    one_line_summary: `${company.name.trim()} — ${company.raw_note ?? "no description provided"}`.slice(0, 160),
    confidence: 0.5,
  };
}

// Mirrors ENRICHMENT_JSON_SCHEMA exactly — this is the line of defense that
// keeps bad model output out of the database. `.strict()` rejects unknown
// keys (matches additionalProperties: false); every required field, enum
// membership, string length, and the confidence range are checked. Throws a
// descriptive error on anything that doesn't conform, which the caller uses
// to decide whether to retry/fall back.
const enrichmentSchema = z
  .object({
    industry: z.string().min(1),
    employee_size_bucket: z.enum(["1-50", "51-200", "201-1000", "1001-5000", "5000+"]),
    hq_country: z.string().min(1),
    one_line_summary: z.string().min(1).max(160),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export function validateEnrichment(raw: unknown): EnrichmentResult {
  const result = enrichmentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Enrichment failed validation: ${result.error.message}`);
  }
  return result.data;
}

// --- Retry / fallback orchestration -----------------------------------------
// The reliability contract for the whole pipeline: never hand back anything
// that hasn't passed validateEnrichment(). A misbehaving model (malformed
// JSON, wrong enum value, out-of-range confidence, or a thrown network error)
// just triggers another attempt rather than propagating bad data.

export interface EnrichmentOutcome {
  result: EnrichmentResult;
  source: string; // provider that actually produced this result, e.g. "mock", "openai"
  model: string | null;
  attempts: number; // total attempts across primary + fallback
  raw: unknown;
}

export class EnrichmentFailedError extends Error {
  constructor(message: string, public attempts: number) {
    super(message);
    this.name = "EnrichmentFailedError";
  }
}

const MAX_PRIMARY_ATTEMPTS = 2;

async function attemptOnce(
  company: CompanyInput,
  provider: string,
  attempt: number,
): Promise<{ result: EnrichmentResult; raw: unknown }> {
  const raw = await enrichWithLLM(company, provider, attempt);
  const result = validateEnrichment(raw);
  return { result, raw };
}

// Tries the configured primary provider up to MAX_PRIMARY_ATTEMPTS times; if
// every attempt fails validation (or throws), falls back to
// FALLBACK_LLM_PROVIDER (default "mock", which is always structurally valid)
// as a last resort. Only throws EnrichmentFailedError once both are
// exhausted — callers should treat that as "mark the company failed, do not
// persist an enrichment_results row."
export async function enrichWithRetryAndFallback(
  company: CompanyInput,
): Promise<EnrichmentOutcome> {
  const primaryProvider = PROVIDER;
  const fallbackProvider = Deno.env.get("FALLBACK_LLM_PROVIDER") ?? "mock";
  let attempts = 0;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PRIMARY_ATTEMPTS; attempt++) {
    attempts++;
    try {
      const { result, raw } = await attemptOnce(company, primaryProvider, attempt);
      return { result, source: primaryProvider, model: modelIdFor(primaryProvider), attempts, raw };
    } catch (e) {
      lastError = e;
    }
  }

  if (fallbackProvider !== primaryProvider) {
    attempts++;
    try {
      const { result, raw } = await attemptOnce(company, fallbackProvider, 1);
      return {
        result,
        source: `${fallbackProvider} (fallback)`,
        model: modelIdFor(fallbackProvider),
        attempts,
        raw,
      };
    } catch (e) {
      lastError = e;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new EnrichmentFailedError(
    `Enrichment failed after ${attempts} attempt(s): ${reason}`,
    attempts,
  );
}
