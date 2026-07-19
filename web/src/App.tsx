import { useCallback, useEffect, useState } from "react";
import { listCompanies, triggerEnrich } from "./api/companies";
import type { Company } from "./types";
import { CompaniesTable } from "./components/CompaniesTable";
import { CompanyDetail } from "./components/CompanyDetail";

const PAGE_SIZE = 25;

export default function App() {
  const [rows, setRows] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Company | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Debounce the free-text filter so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  // A new filter invalidates the current page.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const refresh = useCallback(() => {
    setLoading(true);
    listCompanies({ page, pageSize: PAGE_SIZE, search: debouncedSearch })
      .then((res) => {
        setRows(res.rows);
        setTotal(res.total);
        // Keep the detail panel's copy of the selected row (e.g. its status)
        // in sync with what just came back from the server.
        setSelected((prev) => (prev ? res.rows.find((r) => r.id === prev.id) ?? prev : prev));
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRerun(companyId: string) {
    setPendingIds((prev) => new Set(prev).add(companyId));
    try {
      await triggerEnrich(companyId);
    } catch (e) {
      console.error(e);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(companyId);
        return next;
      });
      refresh();
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Company Enrichment</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Take-home starter — see <code>TASK.md</code>. Most of this is yours to build.
      </p>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 2, minWidth: 0 }}>
          <CompaniesTable
            rows={rows}
            loading={loading}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            search={search}
            onSearchChange={setSearch}
            onPageChange={setPage}
            onSelect={setSelected}
            onRerun={handleRerun}
            pendingIds={pendingIds}
          />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <CompanyDetail company={selected} />
        </div>
      </div>
    </main>
  );
}
