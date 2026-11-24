import { ArrowDown, ArrowUp, Hotel, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, EmptyState, Input, Select } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import type { TabProps } from "./types";
import { useSave } from "./useSave";

interface HotelOption {
  id: string;
  name: string;
  city: string;
  starRating: number | null;
  isActive: boolean;
}

interface Row {
  hotelId: string;
  nights: string;
  notes: string;
}

export function HotelsTab({ pkg, onSaved, readOnly }: TabProps) {
  const { data: hotels } = useApi<HotelOption[]>("/admin/catalogue/hotels");
  const { saving, run, api } = useSave(onSaved);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => setRows(pkg.hotels.map((h) => ({ hotelId: h.hotelId, nights: String(h.nights), notes: h.notes ?? "" }))), [pkg]);

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const n = [...r];
      [n[i], n[i + d]] = [n[i + d]!, n[i]!];
      return n;
    });
  const totalNights = rows.reduce((s, r) => s + (Number(r.nights) || 0), 0);

  const save = () => run(() => api.put(`/admin/packages/${pkg.id}/hotels`, { hotels: rows.filter((r) => r.hotelId).map((r) => ({ hotelId: r.hotelId, nights: Number(r.nights) || 0, notes: r.notes || null })) }));

  if (hotels && hotels.length === 0) return <EmptyState icon={Hotel} title="No hotels yet">Add hotels in Catalogue setup first.</EmptyState>;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <EmptyState icon={Hotel} title="No hotels in this package">{pkg.vertical === "tourism" ? "Optional for tour packages." : "Add the Makkah and Madinah hotels with the number of nights."}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Hotel</th>
                <th className="w-28 py-2 pr-3">Nights</th>
                <th className="py-2 pr-3">Note (room basis, view…)</th>
                {!readOnly && <th className="w-32 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3">
                    <Select value={r.hotelId} onChange={(e) => update(i, { hotelId: e.target.value })} disabled={readOnly}>
                      <option value="">Choose a hotel</option>
                      {(hotels ?? []).filter((h) => h.isActive || h.id === r.hotelId).map((h) => (
                        <option key={h.id} value={h.id}>{h.city} · {h.name}{h.starRating ? ` (${h.starRating}★)` : ""}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-3"><Input type="number" min={0} value={r.nights} onChange={(e) => update(i, { nights: e.target.value })} disabled={readOnly} /></td>
                  <td className="py-2 pr-3"><Input value={r.notes} onChange={(e) => update(i, { notes: e.target.value })} disabled={readOnly} maxLength={200} /></td>
                  {!readOnly && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
                      <Button size="sm" variant="ghost" icon={ArrowDown} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-slate-500">Total nights: <b>{totalNights}</b>{pkg.durationNights ? ` (package: ${pkg.durationNights})` : ""}</p>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Plus} onClick={() => setRows([...rows, { hotelId: "", nights: "", notes: "" }])}>Add hotel</Button>
          <Button loading={saving} onClick={save}>Save hotels</Button>
        </div>
      )}
    </div>
  );
}
