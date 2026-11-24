import { useState } from "react";
import { formatMoney } from "../../utils/format";

export interface MonthSales {
  month: string;
  umrah: number;
  hajj: number;
  tourism: number;
  bookings: number;
}

/** Categorical slots 1–3 of the validated reference palette (light surface); fixed order, never cycled. */
const SERIES = [
  { key: "umrah", label: "Umrah", color: "#2a78d6" },
  { key: "hajj", label: "Hajj", color: "#eb6834" },
  { key: "tourism", label: "International Tourism", color: "#1baf7a" },
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Compact amount for the axis: 1.2M, 850K. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

/** Stacked monthly sales by product type: one y-axis, 2px gaps between segments, hover tooltip, table view. */
export function SalesChart({ months, currency }: { months: MonthSales[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const totals = months.map((m) => m.umrah + m.hajj + m.tourism);
  const max = Math.max(...totals, 1);
  // Round the axis top to a tidy step.
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const H = 180;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
        ))}
        <button onClick={() => setShowTable((v) => !v)} className="ml-auto font-medium text-brand-700 hover:underline">{showTable ? "Show chart" : "Show table"}</button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="py-2 pr-3">Month</th>{SERIES.map((s) => <th key={s.key} className="py-2 pr-3 text-right">{s.label}</th>)}<th className="py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {months.map((m, i) => (
                <tr key={m.month}>
                  <td className="py-1.5 pr-3 text-slate-600">{monthLabel(m.month)}</td>
                  {SERIES.map((s) => <td key={s.key} className="py-1.5 pr-3 text-right text-slate-700">{formatMoney(m[s.key], currency)}</td>)}
                  <td className="py-1.5 text-right font-medium text-slate-900">{formatMoney(totals[i], currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative flex gap-2" role="img" aria-label={`Sales by month: ${months.map((m, i) => `${monthLabel(m.month)} ${formatMoney(totals[i], currency)}`).join(", ")}`}>
          <div className="relative w-10 shrink-0 text-right text-[11px] text-slate-400" style={{ height: H }}>
            {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>{compact(t)}</span>)}
          </div>
          <div className="relative flex-1">
            {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: H - (t / top) * H }} />)}
            <div className="relative flex items-end justify-around gap-2" style={{ height: H }}>
              {months.map((m, i) => (
                <div
                  key={m.month}
                  className="relative flex h-full flex-1 cursor-default flex-col items-center justify-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div className="flex w-full max-w-10 flex-col-reverse gap-[2px]">
                    {SERIES.map((s, si) => {
                      const v = m[s.key];
                      if (!v) return null;
                      const isTop = SERIES.slice(si + 1).every((x) => !m[x.key]);
                      return <div key={s.key} style={{ height: Math.max(2, (v / top) * H - 2), background: s.color, borderRadius: isTop ? "4px 4px 0 0" : 0, opacity: hover === null || hover === i ? 1 : 0.55 }} />;
                    })}
                  </div>
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full z-10 mb-1 w-48 rounded-lg bg-white p-2.5 text-xs shadow-lg ring-1 ring-slate-200">
                      <p className="mb-1 font-semibold text-slate-800">{monthLabel(m.month)} · {m.bookings} booking{m.bookings === 1 ? "" : "s"}</p>
                      {SERIES.map((s) => (
                        <p key={s.key} className="flex items-center justify-between gap-2 text-slate-600">
                          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                          <span className="text-slate-800">{formatMoney(m[s.key], currency)}</span>
                        </p>
                      ))}
                      <p className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900"><span>Total</span><span>{formatMoney(totals[i], currency)}</span></p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-around gap-2 text-[11px] text-slate-500">
              {months.map((m) => <span key={m.month} className="flex-1 text-center">{monthLabel(m.month)}</span>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
