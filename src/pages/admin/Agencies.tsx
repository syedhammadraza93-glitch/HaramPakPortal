import { Building2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Card, EmptyState, Input, PageHeader, Pagination, Spinner, StatusBadge, cx } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import type { AgencyStatus } from "../../utils/api";
import { formatDate } from "../../utils/format";

interface AgencyRow {
  id: string;
  agentCode: string | null;
  agencyName: string;
  authorizedPerson: string;
  email: string;
  phone: string;
  city: string;
  status: AgencyStatus;
  createdAt: string;
}

interface Page {
  items: AgencyRow[];
  total: number;
  page: number;
  pageSize: number;
}

const TABS: { key: string; label: string }[] = [
  { key: "queue", label: "Review queue" },
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
  { key: "deactivated", label: "Deactivated" },
  { key: "pending_email_verification", label: "Email not verified" },
];

export function Agencies() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "queue";
  const page = Number(params.get("page") ?? 1);
  const search = params.get("search") ?? "";
  const [term, setTerm] = useState(search);

  // Search as you type (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (term !== search) setParams((p) => { const n = new URLSearchParams(p); term ? n.set("search", term) : n.delete("search"); n.delete("page"); return n; });
    }, 350);
    return () => clearTimeout(t);
  }, [term, search, setParams]);

  const { data, loading, error } = useApi<Page>("/admin/agencies", { status: status || undefined, page, search: search || undefined });

  const setTab = (key: string) => setParams(() => { const n = new URLSearchParams(); n.set("status", key); if (search) n.set("search", search); return n; });

  return (
    <div>
      <PageHeader title="Agencies" description="Review new registrations and manage registered travel agencies." />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                status === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name, email, phone, Agent ID" className="pl-9" />
        </div>
      </div>

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <Spinner />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={Building2} title={status === "queue" ? "No applications waiting" : "No agencies found"}>
            {search ? "Try a different search." : status === "queue" ? "New registrations appear here after the agent verifies their email." : undefined}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Agency</th>
                    <th className="px-4 py-3">Agent ID</th>
                    <th className="px-4 py-3">City</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Registered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((a) => (
                    <tr key={a.id} onClick={() => navigate(`/admin/agencies/${a.id}`)} className={cx("cursor-pointer hover:bg-brand-50/40", loading && "opacity-60")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{a.agencyName}</p>
                        <p className="text-xs text-slate-500">{a.authorizedPerson}</p>
                      </td>
                      <td className="px-4 py-3">{a.agentCode ? <Badge tone="green">{a.agentCode}</Badge> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-3 text-slate-600">{a.city}</td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{a.email}</p>
                        <p className="text-xs text-slate-500">{a.phone}</p>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParams((prev) => { const n = new URLSearchParams(prev); n.set("page", String(p)); return n; })} />
          </>
        )}
      </Card>
    </div>
  );
}
