import { ChevronDown, ChevronRight, ClipboardList, Search } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Alert, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { formatDateTime } from "../../utils/format";

interface AuditRow {
  id: string;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: unknown;
  newValues: unknown;
  ip: string | null;
  createdAt: string;
}

interface Page {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function AuditLog() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("");
  const [term, setTerm] = useState("");
  const [action, setAction] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setAction(term); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [term]);

  const { data, loading, error } = useApi<Page>("/admin/audit-log", { page, entityType: entityType || undefined, action: action || undefined });

  return (
    <div>
      <PageHeader title="Audit log" description="Every important change: who did it, when and from where." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter by action, e.g. agency.approve" className="pl-9" />
        </div>
        <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="sm:w-48">
          <option value="">All records</option>
          <option value="agency">Agencies</option>
          <option value="user">Users</option>
          <option value="role">Roles</option>
          <option value="settings">Settings</option>
        </Select>
      </div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Card className="overflow-hidden">
        {loading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState icon={ClipboardList} title="No audit entries" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8 px-3 py-3" />
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Who</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Record</th>
                    <th className="px-4 py-3">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((r) => {
                    const hasDetail = r.oldValues != null || r.newValues != null;
                    const isOpen = expanded === r.id;
                    return (
                      <Fragment key={r.id}>
                        <tr className={hasDetail ? "cursor-pointer hover:bg-slate-50" : ""} onClick={() => hasDetail && setExpanded(isOpen ? null : r.id)}>
                          <td className="px-3 py-3 text-slate-400">{hasDetail && (isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(r.createdAt)}</td>
                          <td className="px-4 py-3 text-slate-700">{r.userEmail ?? <span className="text-slate-400">system / public</span>}</td>
                          <td className="px-4 py-3 font-mono text-xs text-brand-700">{r.action}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{r.ip ?? "—"}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50">
                            <td />
                            <td colSpan={5} className="px-4 py-3">
                              <div className="grid gap-3 lg:grid-cols-2">
                                {r.oldValues != null && <pre className="overflow-x-auto rounded-lg bg-white p-3 text-xs ring-1 ring-slate-200"><b className="text-accent-600">Before</b>{"\n"}{JSON.stringify(r.oldValues, null, 2)}</pre>}
                                {r.newValues != null && <pre className="overflow-x-auto rounded-lg bg-white p-3 text-xs ring-1 ring-slate-200"><b className="text-brand-700">After</b>{"\n"}{JSON.stringify(r.newValues, null, 2)}</pre>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
