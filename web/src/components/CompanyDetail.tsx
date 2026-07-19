import { useEffect, useState } from "react";
import { getEnrichment } from "../api/companies";
import type { Company, EnrichmentResult } from "../types";

interface Props {
  company: Company | null;
}

export function CompanyDetail({ company }: Props) {
  const [enrichment, setEnrichment] = useState<EnrichmentResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!company) {
      setEnrichment(null);
      return;
    }
    setLoading(true);
    setEnrichment(null);
    getEnrichment(company.id)
      .then(setEnrichment)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [company?.id]);

  if (!company) {
    return (
      <aside className="detail-empty">
        <p>Select a company to see its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <h2>{company.name.trim()}</h2>
      <p className="detail-note">{company.raw_note ?? "No note"}</p>

      {company.status === "failed" && company.last_error && (
        <p className="detail-error">Last error: {company.last_error}</p>
      )}

      {loading ? (
        <p>Loading enrichment…</p>
      ) : !enrichment ? (
        <p className="detail-status">
          No enrichment yet — status: <strong>{company.status}</strong>.
        </p>
      ) : (
        <dl className="detail-fields">
          <dt>Industry</dt>
          <dd>{enrichment.industry}</dd>

          <dt>Employee size</dt>
          <dd>{enrichment.employee_size_bucket}</dd>

          <dt>HQ country</dt>
          <dd>{enrichment.hq_country}</dd>

          <dt>Summary</dt>
          <dd>{enrichment.one_line_summary}</dd>

          <dt>Confidence</dt>
          <dd>{Math.round(enrichment.confidence * 100)}%</dd>

          <dt>Source</dt>
          <dd>
            {enrichment.source}
            {enrichment.model ? ` (${enrichment.model})` : ""}
          </dd>

          <dt>Updated</dt>
          <dd>{new Date(enrichment.updated_at).toLocaleString()}</dd>
        </dl>
      )}
    </aside>
  );
}
