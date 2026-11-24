import { BookOpen, Plane, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Card, EmptyState, Input, PageHeader, Pagination, Spinner, cx } from "../../../components/ui";
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
  agentReference: string | null;
  holdExpiresAt: string | null;
  updatedAt: string;
  leadPassenger: string | null;
}

const TABS = [
  { key: "open", label: "Open" },
  { key: "draft", label: "Drafts" },
  { key: "information_required", label: "Need my action" },
  { key: "quotation_sent", label: "Quotations" },
  { key: "", label: "All" },
];

export function MyBookings() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const search = params.get("search") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [term, setTerm] = useState(search);
  const set = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("status", k === "status" ? v : status);
      if (k !== "status") v ? n.set(k, v) : n.delete(k);
      if (k !== "page") n.delete("page");
      return n;
    });
  useEffect(() => {
    const t = setTimeout(() => term !== search && set("search", term), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const { data, loading, error } = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>("/agent/bookings", { status: status || undefined, search: search || undefined, page });

  return (
    <div>
      <PageHeader title="My bookings" description="Bookings and quotation requests of your agency." actions={<Link to="/agent/packages" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><Plane className="size-4" /> New booking</Link>} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => set("status", t.key)} className={cx("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium", status === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>{t.label}</button>
          ))}
        </div>
        <div className="relative lg:w-96">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Reference, package, passenger or your reference" className="pl-9" />
        </div>
      </div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <EmptyState icon={BookOpen} title="No bookings here">Open a package and click Book to start.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">Booking</th><th className="px-4 py-3">Package</th><th className="px-4 py-3">Departure</th><th className="px-4 py-3">Passengers</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((b) => {
                    const hold = ["submitted", "under_review", "information_required"].includes(b.status) ? holdLeft(b.holdExpiresAt) : null;
                    return (
                      <tr key={b.id} onClick={() => navigate(`/agent/bookings/${b.id}`)} className={cx("cursor-pointer hover:bg-brand-50/40", loading && "opacity-60")}>
                        <td className="px-4 py-3"><p className="font-mono text-xs font-semibold text-slate-800">{b.reference ?? "Draft"}</p><p className="text-xs text-slate-500">{b.agentReference ? `${b.agentReference} · ` : ""}{timeAgo(b.updatedAt)}</p></td>
                        <td className="px-4 py-3"><p className="text-slate-800">{b.packageName}</p><p className="text-xs text-slate-500">{VERTICALS[b.vertical]}{b.isQuotation ? " · quotation" : ""}</p></td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(b.departureDate)}</td>
                        <td className="px-4 py-3 text-slate-600">{b.paxCount}{b.leadPassenger ? ` · ${b.leadPassenger}` : ""}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">{b.totalAmount ? formatMoney(b.totalAmount, b.currency) : "—"}</td>
                        <td className="px-4 py-3"><div className="flex flex-col items-start gap-1"><BookingStatusBadge status={b.status} />{hold && <span className="text-xs text-slate-500">Seats held: {hold}</span>}</div></td>
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
