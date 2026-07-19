// Run with: deno test --allow-env supabase/functions/enrich/llm.test.ts
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1.0.0";
import { EnrichmentFailedError, enrichWithRetryAndFallback, validateEnrichment } from "./llm.ts";
import type { CompanyInput } from "./llm.ts";

const VALID = {
  industry: "Software",
  employee_size_bucket: "51-200",
  hq_country: "Germany",
  one_line_summary: "A software company.",
  confidence: 0.8,
};

const company: CompanyInput = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Test Co",
  domain: "test.co",
  raw_note: "software company",
};

// --- validateEnrichment -------------------------------------------------

Deno.test("validateEnrichment accepts a well-formed result", () => {
  assertEquals(validateEnrichment(VALID), VALID);
});

Deno.test("validateEnrichment rejects a missing required field", () => {
  const { industry: _industry, ...rest } = VALID;
  assertThrows(() => validateEnrichment(rest));
});

Deno.test("validateEnrichment rejects an invalid enum value", () => {
  assertThrows(() => validateEnrichment({ ...VALID, employee_size_bucket: "huge" }));
});

Deno.test("validateEnrichment rejects confidence outside [0, 1]", () => {
  assertThrows(() => validateEnrichment({ ...VALID, confidence: 1.5 }));
});

Deno.test("validateEnrichment rejects a summary over 160 characters", () => {
  assertThrows(() => validateEnrichment({ ...VALID, one_line_summary: "x".repeat(161) }));
});

Deno.test("validateEnrichment rejects unknown extra fields (strict schema)", () => {
  assertThrows(() => validateEnrichment({ ...VALID, unexpected: "nope" }));
});

// --- enrichWithRetryAndFallback ------------------------------------------

Deno.test("enrichWithRetryAndFallback succeeds on the first attempt when the primary provider works", async () => {
  const outcome = await enrichWithRetryAndFallback(company, { primaryProvider: "mock" });
  assertEquals(outcome.source, "mock");
  assertEquals(outcome.attempts, 1);
});

Deno.test("enrichWithRetryAndFallback retries the primary provider before falling back", async () => {
  // "openai" throws on every attempt (not implemented) — this exercises
  // MAX_PRIMARY_ATTEMPTS retries followed by a successful fallback.
  const outcome = await enrichWithRetryAndFallback(company, {
    primaryProvider: "openai",
    fallbackProvider: "mock",
  });
  assertEquals(outcome.source, "mock (fallback)");
  assertEquals(outcome.attempts, 3); // 2 failed primary attempts + 1 fallback attempt
});

Deno.test("enrichWithRetryAndFallback throws once primary and fallback are both exhausted", async () => {
  await assertRejects(
    () =>
      enrichWithRetryAndFallback(company, {
        primaryProvider: "openai",
        fallbackProvider: "mistral",
      }),
    EnrichmentFailedError,
  );
});

Deno.test("enrichWithRetryAndFallback never returns unvalidated data", async () => {
  const outcome = await enrichWithRetryAndFallback(company, { primaryProvider: "mock" });
  // Throws if the result doesn't conform — proves the outcome already passed validation.
  validateEnrichment(outcome.result);
});
