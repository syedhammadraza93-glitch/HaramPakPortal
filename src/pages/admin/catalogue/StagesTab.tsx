import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select, Spinner, Textarea } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { VERTICALS, type Vertical } from "../../../utils/format";

interface Stage { id: string; vertical: Vertical; name: string; description: string | null; sortOrder: number; isActive: boolean }

/** Operational steps Operations ticks off on each booking (e.g. the Hajj process). */
export function StagesTab() {
  const toast = useToast();
  const canManage = useCan("catalogue.manage");
  const [vertical, setVertical] = useState<Vertical>("hajj");
  const { data, loading, reload } = useApi<Stage[]>("/admin/booking-setup/stages", { vertical });
  const [editing, setEditing] = useState<Stage | "new" | null>(null);
  const [f, setF] = useState({ name: "", description: "", sortOrder: "0", isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const open = (s: Stage | "new") => {
    setErrors({});
    setF(s === "new" ? { name: "", description: "", sortOrder: String((data?.length ?? 0) + 1), isActive: true } : { name: s.name, description: s.description ?? "", sortOrder: String(s.sortOrder), isActive: s.isActive });
    setEditing(s);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { vertical, name: f.name, description: f.description || null, sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive };
      const res = editing === "new" ? await api.post("/admin/booking-setup/stages", body) : await api.put(`/admin/booking-setup/stages/${(editing as Stage).id}`, body);
      toast("success", res.message ?? "Saved");
      setEditing(null);
      await reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (s: Stage) => {
    if (!window.confirm(`Delete the stage "${s.name}"? It is removed from every booking's checklist.`)) return;
    try {
      const res = await api.del(`/admin/booking-setup/stages/${s.id}`);
      toast("success", res.message ?? "Deleted");
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <Select value={vertical} onChange={(e) => setVertical(e.target.value as Vertical)} className="w-56">
          {Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {canManage && <Button icon={Plus} onClick={() => open("new")}>Add stage</Button>}
      </div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={ListChecks} title="No stages">Add the steps your team follows after a booking is confirmed, e.g. documents checked, visa applied, visa issued, tickets issued.</EmptyState>
      ) : (
        <ol className="divide-y divide-slate-100">
          {data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{s.sortOrder}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{s.name} {!s.isActive && <Badge>Inactive</Badge>}</p>
                {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
              </div>
              {canManage && <><Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(s)}>Edit</Button><Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(s)} aria-label="Delete stage" /></>}
            </li>
          ))}
        </ol>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing === "new" ? "Add" : "Edit"} stage · ${VERTICALS[vertical]}`} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="stage-form" loading={saving}>Save</Button></>}>
        <form id="stage-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Stage" required error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!errors.name} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-16" /></Field>
          <Field label="Order"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
          <div className="flex items-end pb-2"><Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        </form>
      </Modal>
    </Card>
  );
}
