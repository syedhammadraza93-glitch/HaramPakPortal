import { Pencil, Percent, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useBranding } from "../../../branding/BrandingProvider";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Select, Spinner } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { VERTICALS, formatMoney } from "../../../utils/format";

interface Charge { id: string; name: string; vertical: string | null; chargeType: "percent" | "fixed"; value: number; basis: "per_person" | "per_booking"; isActive: boolean; sortOrder: number }

const EMPTY = { name: "", vertical: "", chargeType: "percent" as "percent" | "fixed", value: "", basis: "per_booking" as "per_person" | "per_booking", isActive: true, sortOrder: "0" };

/** Taxes and charges added to every booking (none until the admin adds them). */
export function ChargesTab() {
  const toast = useToast();
  const { currency } = useBranding();
  const { data, loading, reload } = useApi<Charge[]>("/admin/booking-setup/charges");
  const [editing, setEditing] = useState<Charge | "new" | null>(null);
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const open = (c: Charge | "new") => {
    setErrors({});
    setF(c === "new" ? EMPTY : { name: c.name, vertical: c.vertical ?? "", chargeType: c.chargeType, value: String(c.value), basis: c.basis, isActive: c.isActive, sortOrder: String(c.sortOrder) });
    setEditing(c);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const body = { ...f, vertical: f.vertical || null, value: Number(f.value) || 0, sortOrder: Number(f.sortOrder) || 0 };
      const res = editing === "new" ? await api.post("/admin/booking-setup/charges", body) : await api.put(`/admin/booking-setup/charges/${(editing as Charge).id}`, body);
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
  const remove = async (c: Charge) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    try {
      const res = await api.del(`/admin/booking-setup/charges/${c.id}`);
      toast("success", res.message ?? "Deleted");
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };
  const describe = (c: Charge) => (c.chargeType === "percent" ? `${c.value}% of fares and add-ons` : `${formatMoney(c.value, currency)} ${c.basis === "per_person" ? "per passenger" : "per booking"}`);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <p className="px-1 text-sm text-slate-500">Added to every booking when it is submitted. Bookings already submitted keep their price.</p>
        <Button icon={Plus} onClick={() => open("new")}>Add charge</Button>
      </div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={Percent} title="No taxes or charges">Add taxes or service charges once their treatment is agreed.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Charge</th><th className="px-4 py-3">Applies to</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.vertical ? VERTICALS[c.vertical as keyof typeof VERTICALS] : "All products"}</td>
                  <td className="px-4 py-2.5 text-slate-700">{describe(c)}</td>
                  <td className="px-4 py-2.5">{c.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(c)} aria-label="Delete charge" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add tax or charge" : "Edit tax or charge"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="charge-form" loading={saving}>Save</Button></>}>
        <form id="charge-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!errors.name} placeholder="e.g. Service charge, Sales tax" /></Field>
          <Field label="Applies to">
            <Select value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value })}>
              <option value="">All products</option>
              {Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={f.chargeType} onChange={(e) => setF({ ...f, chargeType: e.target.value as "percent" | "fixed" })}>
              <option value="percent">Percentage of fares and add-ons</option>
              <option value="fixed">Fixed amount ({currency})</option>
            </Select>
          </Field>
          <Field label={f.chargeType === "percent" ? "Percent" : "Amount"} required error={errors.value}><Input type="number" min={0} step="any" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} invalid={!!errors.value} /></Field>
          {f.chargeType === "fixed" && (
            <Field label="Charged">
              <Select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as "per_person" | "per_booking" })}>
                <option value="per_booking">Once per booking</option>
                <option value="per_person">Per passenger</option>
              </Select>
            </Field>
          )}
          <Field label="Order on the invoice"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
          <div className="flex items-end pb-2"><Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        </form>
      </Modal>
    </Card>
  );
}
