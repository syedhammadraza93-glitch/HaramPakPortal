import { BadgePercent, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../../components/Toast";
import { Badge, Button, EmptyState, Input, Spinner } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage } from "../../../utils/api";
import { PAX_TYPES, ROOM_TYPES, formatDate, formatMoney } from "../../../utils/format";
import type { TabProps } from "./types";

interface Special {
  agencyId: string;
  agencyName: string;
  agentCode: string | null;
  rateId: string;
  price: number;
  note: string | null;
}

interface AgencyOption {
  id: string;
  agencyName: string;
  agentCode: string | null;
  city: string;
}

/** A different price for one agency. It wins over the agency's pricing group. */
export function SpecialPricesTab({ pkg, readOnly }: TabProps) {
  const toast = useToast();
  const specials = useApi<Special[]>(`/admin/packages/${pkg.id}/special-prices`);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const agencies = useApi<{ items: AgencyOption[] }>(search.length >= 2 ? "/admin/agencies" : null, { status: "active", search, pageSize: 10 });
  const [agency, setAgency] = useState<AgencyOption | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const depDate = useMemo(() => new Map(pkg.departures.map((d) => [d.id, d.departureDate])), [pkg.departures]);
  const byAgency = useMemo(() => {
    const m = new Map<string, { name: string; code: string | null; items: Special[] }>();
    for (const s of specials.data ?? []) {
      if (!m.has(s.agencyId)) m.set(s.agencyId, { name: s.agencyName, code: s.agentCode, items: [] });
      m.get(s.agencyId)!.items.push(s);
    }
    return [...m.entries()];
  }, [specials.data]);

  const choose = (a: AgencyOption) => {
    setAgency(a);
    setTerm("");
    setPrices(Object.fromEntries((specials.data ?? []).filter((s) => s.agencyId === a.id).map((s) => [s.rateId, String(s.price)])));
  };

  const save = async () => {
    if (!agency) return;
    setSaving(true);
    try {
      const res = await api.put(`/admin/packages/${pkg.id}/special-prices/${agency.id}`, {
        prices: pkg.rates.map((r) => ({ rateId: r.id, price: prices[r.id] ? Number(prices[r.id]) : null })),
      });
      toast("success", res.message ?? "Saved");
      setAgency(null);
      await specials.reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const rateLabel = (rateId: string) => {
    const r = pkg.rates.find((x) => x.id === rateId);
    if (!r) return "Removed price";
    return `${ROOM_TYPES[r.roomType]} · ${PAX_TYPES[r.paxType]}${r.departureId ? ` (${formatDate(depDate.get(r.departureId))})` : ""}`;
  };

  if (pkg.rates.length === 0) return <EmptyState icon={BadgePercent} title="Add prices first">Special prices are set per package price.</EmptyState>;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-3">
        <h3 className="font-semibold text-slate-900">Agencies with special prices</h3>
        {specials.loading && !specials.data ? (
          <Spinner />
        ) : byAgency.length === 0 ? (
          <p className="text-sm text-slate-500">None. All agencies get their pricing group's price.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {byAgency.map(([id, a]) => (
              <li key={id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">{a.name} {a.code && <Badge tone="green">{a.code}</Badge>}</p>
                  {!readOnly && <Button size="sm" variant="ghost" onClick={() => choose({ id, agencyName: a.name, agentCode: a.code, city: "" })}>Edit</Button>}
                </div>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {a.items.map((s) => <li key={s.rateId}>{rateLabel(s.rateId)}: <b>{formatMoney(s.price, pkg.currency)}</b></li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!readOnly && (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900">{agency ? `Special prices for ${agency.agencyName}` : "Set special prices for an agency"}</h3>
          {!agency ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search an active agency by name or Agent ID" className="pl-9" />
              </div>
              {search.length >= 2 && (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {(agencies.data?.items ?? []).map((a) => (
                    <li key={a.id}>
                      <button className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => choose(a)}>
                        {a.agencyName} <span className="text-slate-400">· {a.agentCode} · {a.city}</span>
                      </button>
                    </li>
                  ))}
                  {agencies.data?.items.length === 0 && <li className="px-4 py-2.5 text-sm text-slate-500">No active agency found</li>}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Leave a price empty to use the agency's pricing group.</p>
              {pkg.rates.map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_160px] items-center gap-3">
                  <div className="text-sm">
                    <p className="text-slate-800">{rateLabel(r.id)}</p>
                    <p className="text-xs text-slate-500">Agent price {formatMoney(r.basePrice, pkg.currency)}</p>
                  </div>
                  <Input type="number" min={0} value={prices[r.id] ?? ""} onChange={(e) => setPrices({ ...prices, [r.id]: e.target.value })} placeholder="Group price" />
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <Button loading={saving} onClick={save}>Save special prices</Button>
                <Button variant="secondary" onClick={() => setAgency(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
