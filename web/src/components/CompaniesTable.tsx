import type { Company, EnrichmentStatus } from "../types";

interface Props {
  rows: Company[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  search: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelect: (company: Company) => void;
  onRerun: (companyId: string) => void;
  pendingIds: Set<string>;
}

const STATUS_STYLES: Record<EnrichmentStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#999" },
  enriching: { label: "Enriching…", color: "#b58900" },
  enriched: { label: "Enriched", color: "#2a9d3f" },
  failed: { label: "Failed", color: "#d64545" },
};

// Server-side pagination + free-text filter (~100k rows: the table only ever
// renders one page at a time, `total` comes from the server's exact count).
export function CompaniesTable({
  rows,
  loading,
  total,
  page,
  pageSize,
  search,
  onSearchChange,
  onPageChange,
  onSelect,
  onRerun,
  pendingIds,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Filter by name or note…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ padding: 6, flex: 1, minWidth: 0 }}
        />
        <span style={{ color: "#666", fontSize: 13, whiteSpace: "nowrap" }}>
          {total.toLocaleString()} companies
        </span>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No companies match — load the seed or adjust your filter (see TASK.md).</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Domain</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isRunning = pendingIds.has(c.id) || c.status === "enriching";
              const statusInfo = STATUS_STYLES[c.status] ?? STATUS_STYLES.pending;
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8, cursor: "pointer" }} onClick={() => onSelect(c)}>
                    {c.name.trim()}
                  </td>
                  <td style={{ padding: 8, cursor: "pointer" }} onClick={() => onSelect(c)}>
                    {c.domain ?? "—"}
                  </td>
                  <td style={{ padding: 8, color: statusInfo.color }}>{statusInfo.label}</td>
                  <td style={{ padding: 8 }}>
                    <button onClick={() => onRerun(c.id)} disabled={isRunning}>
                      {isRunning ? "Running…" : c.status === "pending" ? "Run" : "Re-run"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span style={{ fontSize: 13, color: "#666" }}>
          Page {page} of {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}
