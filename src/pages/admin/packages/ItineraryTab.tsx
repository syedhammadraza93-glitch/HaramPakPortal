import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, EmptyState, Field, Input, Textarea } from "../../../components/ui";
import type { TabProps } from "./types";
import { useSave } from "./useSave";

interface Day {
  dayNumber: string;
  title: string;
  city: string;
  description: string;
}

export function ItineraryTab({ pkg, onSaved, readOnly }: TabProps) {
  const { saving, run, api } = useSave(onSaved);
  const [days, setDays] = useState<Day[]>([]);
  useEffect(
    () => setDays(pkg.itinerary.map((d) => ({ dayNumber: String(d.dayNumber), title: d.title, city: d.city ?? "", description: d.description ?? "" }))),
    [pkg],
  );

  const update = (i: number, patch: Partial<Day>) => setDays((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addDay = () => {
    const next = days.reduce((m, d) => Math.max(m, Number(d.dayNumber) || 0), 0) + 1;
    setDays([...days, { dayNumber: String(next), title: "", city: "", description: "" }]);
  };
  const save = () =>
    run(() =>
      api.put(`/admin/packages/${pkg.id}/itinerary`, {
        days: days.map((d) => ({ dayNumber: Number(d.dayNumber), title: d.title, city: d.city || null, description: d.description || null })),
      }),
    );

  return (
    <div className="space-y-4">
      {days.length === 0 && <EmptyState icon={CalendarDays} title="No itinerary yet">Add the plan day by day: sightseeing, activities, free time.</EmptyState>}
      <div className="space-y-3">
        {days.map((d, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[100px_1fr_200px_auto]">
            <Field label="Day"><Input type="number" min={1} value={d.dayNumber} onChange={(e) => update(i, { dayNumber: e.target.value })} disabled={readOnly} /></Field>
            <Field label="Title"><Input value={d.title} onChange={(e) => update(i, { title: e.target.value })} disabled={readOnly} placeholder="e.g. Arrival and city tour" /></Field>
            <Field label="City"><Input value={d.city} onChange={(e) => update(i, { city: e.target.value })} disabled={readOnly} /></Field>
            {!readOnly && <div className="flex items-end"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDays(days.filter((_, j) => j !== i))} aria-label="Remove day" /></div>}
            <Field label="What happens" className="md:col-span-4"><Textarea value={d.description} onChange={(e) => update(i, { description: e.target.value })} disabled={readOnly} className="min-h-16" /></Field>
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Plus} onClick={addDay}>Add day</Button>
          <Button loading={saving} onClick={save}>Save itinerary</Button>
        </div>
      )}
    </div>
  );
}
