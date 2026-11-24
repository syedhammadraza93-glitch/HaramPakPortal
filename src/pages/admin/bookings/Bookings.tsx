import { ClipboardList, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { VERTICALS, formatDate, formatMoney, timeAgo } from "../../../utils/format";
import { BookingStatusBadge, holdLeft } from "../../bookings/shared";

interface Row {
  id: string;
  reference: string | null;
  packageName: string;
  vertical: keyof typeof VERTICALS;
  departureDate: string | null;
  status: string;
  paxCount: number;
  totalAmount: number;
  currency: string;
  isQuotation: boolean;
  holdExpiresAt: string | null;
  submittedAt: string | null;
  agencyName: string;
  agentCode: string | null;
  leadPassenger: string | null;
  pendingDocuments: number;
}

const TABS = [
  { key: "queue", label: "To do" },
  { key: "active", label: "Confirmed & in progress" },
  { key: "", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "rejected", label: "Rejected" },
];

export function Bookings() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "queue";
  const vertical = params.get("vertical") ?? "";
  const search = params.get("search") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [term, setTerm] = useState(search);

  const set = (key: string, value: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("status", key === "status" ? value : status);
      if (key !== "status") value ? n.set(key, value) : n.delete(key);
      if (key !== "page") n.delete("page");
      return n;
    });

  useEffect(() => {
    const t = setTimeout(() => term !== search && set("search", term), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const { data, loading, error } = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>("/admin/bookings", {
    status: status || undefined, vertical: vertical || undefined, search: search || undefined, page,
  });

  return (
    <div>
      <PageHeader title="Bookings" description="Review new bookings and quotation requests, then confirm and process them." />
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => set("status", t.key)} className={cx("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition", status === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={vertical} onChange={(e) => set("vertical", e.target.value)} className="sm:w-52" aria-label="Product type">
            <option value="">All product types</option>
            {Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <div className="relative sm:w-96">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Reference, agency, passenger or passport no." className="pl-9" />
          </div>
        </div>
      </div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <EmptyState icon={ClipboardList} title={status === "queue" ? "Nothing to do" : "No bookings"}>{status === "queue" ? "New bookings and quotation requests appear here." : undefined}</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Booking</th><th className="px-4 py-3">Agency</th><th className="px-4 py-3">Package</th><th className="px-4 py-3">Departure</th>
                    <th className="px-4 py-3">Pax</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((b) => {
                    const hold = holdLeft(b.holdExpiresAt);
                    return (
                      <tr key={b.id} onClick={() => navigate(`/admin/bookings/${b.id}`)} className={cx("cursor-pointer hover:bg-brand-50/40", loading && "opacity-60")}>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-semibold text-slate-800">{b.reference}</p>
                          <p className="text-xs text-slate-500">{b.leadPassenger ?? "—"} · {timeAgo(b.submittedAt)}</p>
                        </td>
                        <td className="px-4 py-3"><p className="text-slate-800">{b.agencyName}</p><p className="text-xs text-slate-500">{b.agentCode}</p></td>
                        <td className="px-4 py-3"><p className="text-slate-800">{b.packageName}</p><p className="text-xs text-slate-500">{VERTICALS[b.vertical]}{b.isQuotation ? " · quotation request" : ""}</p></td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(b.departureDate)}</td>
                        <td className="px-4 py-3 text-slate-600">{b.paxCount}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">{b.totalAmount ? formatMoney(b.totalAmount, b.currency) : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <BookingStatusBadge status={b.status} />
                            {b.pendingDocuments > 0 && <Badge tone="amber">{b.pendingDocuments} docs to check</Badge>}
                            {hold && ["submitted", "under_review", "information_required"].includes(b.status) && <span className={cx("text-xs", hold === "expired" ? "text-accent-600" : "text-slate-500")}>Hold: {hold}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set("page", String(p))} />
          </>
        )}
      </Card>
    </div>
  );
}
