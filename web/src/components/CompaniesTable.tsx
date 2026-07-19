import type { Company, EnrichmentStatus } from "../types";

interface Props {
  rows: Company[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: EnrichmentStatus | "";
  onStatusFilterChange: (value: EnrichmentStatus | "") => void;
  onPageChange: (page: number) => void;
  onSelect: (company: Company) => void;
  onRerun: (companyId: string) => void;
  pendingIds: Set<string>;
}

const STATUS_LABELS: Record<EnrichmentStatus, string> = {
  pending: "Pending",
  enriching: "Enriching…",
  enriched: "Enriched",
  failed: "Failed",
};

const STATUS_OPTIONS: EnrichmentStatus[] = ["pending", "enriching", "enriched", "failed"];

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
  statusFilter,
  onStatusFilterChange,
  onPageChange,
  onSelect,
  onRerun,
  pendingIds,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="table-toolbar">
        <input
          type="text"
          placeholder="Filter by name or note…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="table-toolbar__input"
        />
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as EnrichmentStatus | "")}
          className="table-toolbar__select"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="table-toolbar__count">{total.toLocaleString()} companies</span>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No companies match — load the seed or adjust your filter (see TASK.md).</p>
      ) : (
        <table className="companies-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Domain</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isRunning = pendingIds.has(c.id) || c.status === "enriching";
              return (
                <tr key={c.id}>
                  <td className="clickable" onClick={() => onSelect(c)}>
                    {c.name.trim()}
                  </td>
                  <td className="clickable" onClick={() => onSelect(c)}>
                    {c.domain ?? "—"}
                  </td>
                  <td className={`status-badge--${c.status}`}>{STATUS_LABELS[c.status]}</td>
                  <td>
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

      <div className="pagination">
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span className="pagination__label">
          Page {page} of {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}
