import { Plus, Tags, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, EmptyState, Input, Select } from "../../../components/ui";
import { PAX_TYPES, ROOM_TYPES, formatDate } from "../../../utils/format";
import type { Rate, TabProps } from "./types";
import { useSave } from "./useSave";

interface Row {
  key: number;
  id?: string;
  departureId: string | null;
  roomType: string;
  paxType: string;
  basePrice: string;
  retailPrice: string;
  isActive: boolean;
}

let nextKey = 1;
const toRow = (r: Rate): Row => ({
  key: nextKey++,
  id: r.id,
  departureId: r.departureId,
  roomType: r.roomType,
  paxType: r.paxType,
  basePrice: String(r.basePrice ?? ""),
  retailPrice: r.retailPrice === null || r.retailPrice === undefined ? "" : String(r.retailPrice),
  isActive: r.isActive,
});

/** Agent prices per room type and passenger type; a departure can have its own prices. */
export function PricesTab({ pkg, onSaved, readOnly }: TabProps) {
  const { saving, errors, run, api } = useSave(onSaved);
  const [rows, setRows] = useState<Row[]>([]);
  const [scope, setScope] = useState<string>("all");
  useEffect(() => setRows(pkg.rates.map(toRow)), [pkg]);

  const scopeDeparture = scope === "all" ? null : scope;
  const visible = useMemo(() => rows.filter((r) => r.departureId === scopeDeparture), [rows, scopeDeparture]);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (roomType: string, paxType: string) =>
    setRows((rs) => (rs.some((r) => r.departureId === scopeDeparture && r.roomType === roomType && r.paxType === paxType) ? rs : [...rs, { key: nextKey++, departureId: scopeDeparture, roomType, paxType, basePrice: "", retailPrice: "", isActive: true }]));

  const save = () =>
    run(() =>
      api.put(`/admin/packages/${pkg.id}/rates`, {
        rates: rows.filter((r) => r.basePrice !== "").map((r) => ({ id: r.id, departureId: r.departureId, roomType: r.roomType, paxType: r.paxType, basePrice: Number(r.basePrice), retailPrice: r.retailPrice === "" ? null : Number(r.retailPrice), isActive: r.isActive })),
      }),
    );

  const countFor = (depId: string | null) => rows.filter((r) => r.departureId === depId).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="md:w-96">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Prices for</label>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All departures (default prices) · {countFor(null)}</option>
            {pkg.departures.map((d) => (
              <option key={d.id} value={d.id}>Only {formatDate(d.departureDate)} (overrides the default) · {countFor(d.id)}</option>
            ))}
          </Select>
        </div>
        <p className="text-sm text-slate-500">
          Agent price = what agencies pay before their pricing group or special price. Reference price is an optional suggested public price.
        </p>
      </div>

      {errors.rates && <p className="text-sm text-accent-600">{errors.rates}</p>}

      {visible.length === 0 ? (
        <EmptyState icon={Tags} title={scopeDeparture ? "No special prices for this date" : "No prices yet"}>
          {scopeDeparture ? "This departure uses the default prices." : "Add a price for each room type and passenger type you sell."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Room</th>
                <th className="py-2 pr-3">Passenger</th>
                <th className="py-2 pr-3">Agent price ({pkg.currency})</th>
                <th className="py-2 pr-3">Reference price</th>
                <th className="py-2 pr-3">Active</th>
                {!readOnly && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => (
                <tr key={r.key}>
                  <td className="py-2 pr-3">
                    <Select value={r.roomType} onChange={(e) => update(r.key, { roomType: e.target.value })} disabled={readOnly} className="min-w-28">
                      {Object.entries(ROOM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </td>
                  <td className="py-2 pr-3">
                    <Select value={r.paxType} onChange={(e) => update(r.key, { paxType: e.target.value })} disabled={readOnly} className="min-w-40">
                      {Object.entries(PAX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </td>
                  <td className="py-2 pr-3"><Input type="number" min={0} value={r.basePrice} onChange={(e) => update(r.key, { basePrice: e.target.value })} disabled={readOnly} className="min-w-32" /></td>
                  <td className="py-2 pr-3"><Input type="number" min={0} value={r.retailPrice} onChange={(e) => update(r.key, { retailPrice: e.target.value })} disabled={readOnly} className="min-w-32" placeholder="Optional" /></td>
                  <td className="py-2 pr-3"><Checkbox label="" checked={r.isActive} onChange={(e) => update(r.key, { isActive: e.target.checked })} disabled={readOnly} /></td>
                  {!readOnly && <td className="py-2 text-right"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Remove price" /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={Plus} onClick={() => add("quad", "adult")}>Add price</Button>
          <Button variant="ghost" onClick={() => Object.keys(ROOM_TYPES).forEach((room) => add(room, "adult"))}>Add adult price for every room type</Button>
          <Button loading={saving} onClick={save}>Save prices</Button>
          <span className="text-xs text-slate-500">Saves the prices for all departures. Rows without an agent price are removed.</span>
        </div>
      )}
    </div>
  );
}
