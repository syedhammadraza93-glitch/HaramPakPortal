import { CalendarDays, Clock, MapPin, Package as PackageIcon, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { VERTICALS, formatDate, formatMoney, type Vertical } from "../../../utils/format";

export interface CatalogueItem {
  id: string;
  code: string;
  vertical: Vertical;
  name: string;
  category: string | null;
  summary: string | null;
  bookingMode: "fixed_departure" | "on_request";
  durationDays: number | null;
  durationNights: number | null;
  seasonYear: number | null;
  destination: string | null;
  currency: string;
  fromPrice: number;
  nextDeparture: { date: string; seatsLeft: number | null; bookingDeadline: string | null } | null;
  departureCount: number;
  coverUrl: string | null;
  flags: { visa: boolean; airTicket: boolean; transport: boolean; ziyarat: boolean };
}

const FLAG_LABELS: [keyof CatalogueItem["flags"], string][] = [["visa", "Visa"], ["airTicket", "Air ticket"], ["transport", "Transport"], ["ziyarat", "Ziyarat"]];

export function IncludedChips({ flags }: { flags: CatalogueItem["flags"] }) {
  const on = FLAG_LABELS.filter(([k]) => flags[k]);
  if (!on.length) return null;
  return <div className="flex flex-wrap gap-1">{on.map(([k, l]) => <Badge key={k} tone="green">{l} included</Badge>)}</div>;
}

export function PackageCard({ p }: { p: CatalogueItem }) {
  return (
    <Link to={`/agent/packages/${p.id}`} className="group">
      <Card className="flex h-full flex-col overflow-hidden transition group-hover:shadow-md">
        <div className="relative aspect-[16/9] bg-brand-50">
          {p.coverUrl ? <img src={p.coverUrl} alt="" className="size-full object-cover" loading="lazy" /> : <PackageIcon className="absolute inset-0 m-auto size-10 text-brand-200" />}
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-brand-700 shadow-sm">
            {VERTICALS[p.vertical]}{p.seasonYear ? ` ${p.seasonYear}` : ""}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <p className="font-semibold text-slate-900 group-hover:text-brand-700">{p.name}</p>
            <p className="mt-0.5 text-xs text-slate-500">{p.code}{p.category ? ` · ${p.category}` : ""}</p>
          </div>
          <div className="space-y-1 text-sm text-slate-600">
            {p.destination && <p className="flex items-center gap-1.5"><MapPin className="size-4 text-slate-400" /> {p.destination}</p>}
            {p.durationDays && <p className="flex items-center gap-1.5"><Clock className="size-4 text-slate-400" /> {p.durationDays} days{p.durationNights ? ` / ${p.durationNights} nights` : ""}</p>}
            {p.nextDeparture ? (
              <p className="flex items-center gap-1.5">
                <CalendarDays className="size-4 text-slate-400" /> Next: {formatDate(p.nextDeparture.date)}
                {p.departureCount > 1 && <span className="text-slate-400">(+{p.departureCount - 1} more)</span>}
              </p>
            ) : (
              <p className="flex items-center gap-1.5"><CalendarDays className="size-4 text-slate-400" /> Dates on request</p>
            )}
            {p.nextDeparture?.seatsLeft !== null && p.nextDeparture?.seatsLeft !== undefined && (
              <p className={cx("flex items-center gap-1.5", p.nextDeparture.seatsLeft <= 5 && "font-medium text-accent-600")}>
                <Users className="size-4 text-slate-400" /> {p.nextDeparture.seatsLeft} seats left
              </p>
            )}
          </div>
          <IncludedChips flags={p.flags} />
          <div className="mt-auto flex items-end justify-between border-t border-slate-100 pt-3">
            <div>
              <p className="text-xs text-slate-500">Your price from</p>
              <p className="text-lg font-bold text-brand-700">{formatMoney(p.fromPrice, p.currency)}</p>
            </div>
            <span className="text-xs text-slate-400">per adult</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function AgentPackages() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const vertical = get("vertical") as "" | Vertical;
  const [term, setTerm] = useState(get("search"));
  const filters = useApi<{ destinations: { id: string; city: string; country: string }[]; categories: string[] }>("/agent/catalogue/filters", { vertical: vertical || undefined });
  const query = {
    vertical: vertical || undefined, destinationId: get("destinationId") || undefined, month: get("month") || undefined, category: get("category") || undefined,
    maxPrice: get("maxPrice") || undefined, search: get("search") || undefined, sort: get("sort") || undefined, page: Number(get("page") || 1), pageSize: 12,
  };
  const { data, loading, error } = useApi<{ items: CatalogueItem[]; total: number; page: number; pageSize: number }>("/agent/catalogue/packages", query);

  const set = (key: string, value: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (value) n.set(key, value);
      else n.delete(key);
      if (key !== "page") n.delete("page");
      if (key === "vertical") {
        n.delete("destinationId");
        n.delete("category");
      }
      return n;
    });

  useEffect(() => {
    const t = setTimeout(() => term !== get("search") && set("search", term), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const tabs: { key: "" | Vertical; label: string }[] = [{ key: "", label: "All" }, ...(Object.entries(VERTICALS) as [Vertical, string][]).map(([key, label]) => ({ key, label }))];

  return (
    <div>
      <PageHeader title="Packages" description="Prices shown are your agency's prices." />
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => set("vertical", t.key)} className={cx("shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition", vertical === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div className="relative lg:col-span-1 2xl:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search packages or destinations" className="pl-9" aria-label="Search" />
          </div>
          <Select value={get("destinationId")} onChange={(e) => set("destinationId", e.target.value)} aria-label="Destination">
            <option value="">All destinations</option>
            {(filters.data?.destinations ?? []).map((d) => <option key={d.id} value={d.id}>{d.city}, {d.country}</option>)}
          </Select>
          <Input type="month" value={get("month")} onChange={(e) => set("month", e.target.value)} aria-label="Travel month" />
          <Select value={get("category")} onChange={(e) => set("category", e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {(filters.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={get("sort") || "departure"} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
            <option value="departure">Soonest departure</option>
            <option value="price">Lowest price</option>
            <option value="name">Name</option>
          </Select>
        </div>
      </Card>

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Card><EmptyState icon={PackageIcon} title="No packages found">Try another product type, month or destination.</EmptyState></Card>
      ) : (
        <>
          <div className={cx("grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4", loading && "opacity-60")}>
            {data.items.map((p) => <PackageCard key={p.id} p={p} />)}
          </div>
          <Card className="mt-5"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set("page", String(p))} /></Card>
        </>
      )}
    </div>
  );
}
