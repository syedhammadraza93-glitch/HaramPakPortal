import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, EmptyState, Input, Select } from "../../../components/ui";
import type { TabProps } from "./types";
import { useSave } from "./useSave";

interface Row {
  id?: string;
  name: string;
  description: string;
  price: string;
  basis: "per_person" | "per_booking";
  isActive: boolean;
}

/** Optional extras an agent can add to a booking (upgrades, excursions, extra ziyarat…). */
export function AddonsTab({ pkg, onSaved, readOnly }: TabProps) {
  const { saving, run, api } = useSave(onSaved);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => setRows(pkg.addons.map((a) => ({ id: a.id, name: a.name, description: a.description ?? "", price: String(a.price), basis: a.basis, isActive: a.isActive }))), [pkg]);
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = () =>
    run(() =>
      api.put(`/admin/packages/${pkg.id}/addons`, {
        addons: rows.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name, description: r.description || null, price: Number(r.price) || 0, basis: r.basis, isActive: r.isActive })),
      }),
    );

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <EmptyState icon={PackagePlus} title="No add-ons">Optional extras such as room upgrades, excursions or extra ziyarat.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Price ({pkg.currency})</th>
                <th className="py-2 pr-3">Charged</th>
                <th className="py-2 pr-3">Active</th>
                {!readOnly && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`}>
                  <td className="py-2 pr-3"><Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} disabled={readOnly} className="min-w-44" /></td>
                  <td className="py-2 pr-3"><Input value={r.description} onChange={(e) => update(i, { description: e.target.value })} disabled={readOnly} className="min-w-56" /></td>
                  <td className="py-2 pr-3"><Input type="number" min={0} value={r.price} onChange={(e) => update(i, { price: e.target.value })} disabled={readOnly} className="min-w-28" /></td>
                  <td className="py-2 pr-3">
                    <Select value={r.basis} onChange={(e) => update(i, { basis: e.target.value as Row["basis"] })} disabled={readOnly} className="min-w-36">
                      <option value="per_person">Per person</option>
                      <option value="per_booking">Per booking</option>
                    </Select>
                  </td>
                  <td className="py-2 pr-3"><Checkbox label="" checked={r.isActive} onChange={(e) => update(i, { isActive: e.target.checked })} disabled={readOnly} /></td>
                  {!readOnly && <td className="py-2 text-right"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove add-on" /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Plus} onClick={() => setRows([...rows, { name: "", description: "", price: "", basis: "per_person", isActive: true }])}>Add add-on</Button>
          <Button loading={saving} onClick={save}>Save add-ons</Button>
        </div>
      )}
    </div>
  );
}
