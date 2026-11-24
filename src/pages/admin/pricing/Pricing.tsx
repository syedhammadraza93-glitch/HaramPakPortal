import { BadgePercent, Pencil, Plus, Stamp, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useBranding } from "../../../branding/BrandingProvider";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { formatDate, formatMoney } from "../../../utils/format";
import { ChargesTab } from "./ChargesTab";

export function Pricing() {
  const [tab, setTab] = useState<"groups" | "visa" | "charges">("groups");
  return (
    <div>
      <PageHeader title="Pricing" description="Pricing groups for agencies and Umrah visa rates. Package prices are set on each package." />
      <div className="mb-4 flex gap-1">
        {[{ key: "groups", label: "Pricing groups" }, { key: "visa", label: "Visa rates" }, { key: "charges", label: "Taxes & charges" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key as "groups" | "visa" | "charges")} className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "groups" ? <Groups /> : tab === "visa" ? <VisaRates /> : <ChargesTab />}
    </div>
  );
}

function useForm<T>(empty: T) {
  const [f, setF] = useState<T>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  return { f, setF, errors, setErrors, saving, setSaving };
}

// ---------------- Pricing groups ----------------
interface Group { id: string; code: string; name: string; description: string | null; adjustmentType: "percent" | "fixed"; adjustmentValue: number; isDefault: boolean; isActive: boolean; agencyCount: number }

export const describeAdjustment = (g: Pick<Group, "adjustmentType" | "adjustmentValue">, currency: string) => {
  const v = Number(g.adjustmentValue);
  if (!v) return "Package prices as set";
  const sign = v > 0 ? "+" : "−";
  return g.adjustmentType === "percent" ? `${sign}${Math.abs(v)}% on package prices` : `${sign}${formatMoney(Math.abs(v), currency)} per person`;
};

function Groups() {
  const toast = useToast();
  const { currency } = useBranding();
  const { data, loading, reload } = useApi<Group[]>("/admin/pricing-groups");
  const empty = { code: "", name: "", description: "", adjustmentType: "percent" as "percent" | "fixed", adjustmentValue: "0", isDefault: false, isActive: true };
  const form = useForm(empty);
  const [editing, setEditing] = useState<Group | "new" | null>(null);

  const open = (g: Group | "new") => {
    form.setErrors({});
    form.setF(g === "new" ? empty : { code: g.code, name: g.name, description: g.description ?? "", adjustmentType: g.adjustmentType, adjustmentValue: String(g.adjustmentValue), isDefault: g.isDefault, isActive: g.isActive });
    setEditing(g);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.setSaving(true);
    form.setErrors({});
    try {
      const body = { ...form.f, adjustmentValue: Number(form.f.adjustmentValue) || 0, description: form.f.description || null };
      const res = editing === "new" ? await api.post("/admin/pricing-groups", body) : await api.put(`/admin/pricing-groups/${(editing as Group).id}`, body);
      toast("success", res.message ?? "Saved");
      setEditing(null);
      await reload();
    } catch (err) {
      form.setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      form.setSaving(false);
    }
  };
  const remove = async (g: Group) => {
    if (!window.confirm(`Delete the pricing group ${g.name}?`)) return;
    try {
      const res = await api.del(`/admin/pricing-groups/${g.id}`);
      toast("success", res.message ?? "Deleted");
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <p className="px-1 text-sm text-slate-500">Each agency is placed in a group (on the agency page). Agencies without a group get the default group.</p>
        <Button icon={Plus} onClick={() => open("new")}>Add group</Button>
      </div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={BadgePercent} title="No pricing groups">Without groups, every agency pays the package prices as set.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Group</th><th className="px-4 py-3">Price rule</th><th className="px-4 py-3">Agencies</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-2.5"><p className="font-medium text-slate-800">{g.name} {g.isDefault && <Badge tone="green">Default</Badge>}</p><p className="font-mono text-xs text-slate-400">{g.code}</p></td>
                  <td className="px-4 py-2.5 text-slate-700">{describeAdjustment(g, currency)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{g.agencyCount}</td>
                  <td className="px-4 py-2.5">{g.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(g)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(g)} aria-label="Delete group" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add pricing group" : "Edit pricing group"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="group-form" loading={form.saving}>Save</Button></>}>
        <form id="group-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={form.errors.name}><Input value={form.f.name} onChange={(e) => form.setF({ ...form.f, name: e.target.value })} invalid={!!form.errors.name} placeholder="e.g. Gold" /></Field>
          <Field label="Code" required error={form.errors.code}><Input value={form.f.code} onChange={(e) => form.setF({ ...form.f, code: e.target.value.toUpperCase() })} invalid={!!form.errors.code} placeholder="GOLD" disabled={editing !== "new"} /></Field>
          <Field label="Adjustment">
            <Select value={form.f.adjustmentType} onChange={(e) => form.setF({ ...form.f, adjustmentType: e.target.value as "percent" | "fixed" })}>
              <option value="percent">Percentage of the package price</option>
              <option value="fixed">Fixed amount per person ({currency})</option>
            </Select>
          </Field>
          <Field label="Value" error={form.errors.adjustmentValue} hint="Negative = discount, e.g. -5"><Input type="number" step="any" value={form.f.adjustmentValue} onChange={(e) => form.setF({ ...form.f, adjustmentValue: e.target.value })} invalid={!!form.errors.adjustmentValue} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={form.f.description} onChange={(e) => form.setF({ ...form.f, description: e.target.value })} className="min-h-16" /></Field>
          <Checkbox label="Default group (for agencies without a group)" checked={form.f.isDefault} onChange={(e) => form.setF({ ...form.f, isDefault: e.target.checked })} />
          <Checkbox label="Active" checked={form.f.isActive} onChange={(e) => form.setF({ ...form.f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

// ---------------- Visa rates ----------------
interface VisaRate { id: string; name: string; category: string; visaFee: number; serviceFee: number; otherCharges: number; total: number; currency: string; effectiveFrom: string; effectiveTo: string | null; isActive: boolean; notes: string | null; state: "current" | "upcoming" | "expired" | "inactive" }

const STATE_TONE = { current: "green", upcoming: "blue", expired: "slate", inactive: "slate" } as const;

function VisaRates() {
  const toast = useToast();
  const { currency } = useBranding();
  const { data, loading, reload } = useApi<VisaRate[]>("/admin/visa-rates");
  const empty = { name: "", category: "", visaFee: "", serviceFee: "0", otherCharges: "0", effectiveFrom: "", effectiveTo: "", isActive: true, notes: "" };
  const form = useForm(empty);
  const [editing, setEditing] = useState<VisaRate | "new" | null>(null);

  const open = (v: VisaRate | "new") => {
    form.setErrors({});
    form.setF(v === "new" ? empty : { name: v.name, category: v.category, visaFee: String(v.visaFee), serviceFee: String(v.serviceFee), otherCharges: String(v.otherCharges), effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo ?? "", isActive: v.isActive, notes: v.notes ?? "" });
    setEditing(v);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.setSaving(true);
    form.setErrors({});
    try {
      const body = { ...form.f, visaFee: Number(form.f.visaFee), serviceFee: Number(form.f.serviceFee) || 0, otherCharges: Number(form.f.otherCharges) || 0, effectiveTo: form.f.effectiveTo || null, notes: form.f.notes || null };
      const res = editing === "new" ? await api.post("/admin/visa-rates", body) : await api.put(`/admin/visa-rates/${(editing as VisaRate).id}`, body);
      toast("success", res.message ?? "Saved");
      setEditing(null);
      await reload();
    } catch (err) {
      form.setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      form.setSaving(false);
    }
  };
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => form.setF({ ...form.f, [k]: e.target.value });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <p className="px-1 text-sm text-slate-500">To change a rate that is already in use, give it an end date and add a new rate from the next day. Old rates stay on record.</p>
        <Button icon={Plus} onClick={() => open("new")}>Add visa rate</Button>
      </div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={Stamp} title="No visa rates">Agents see the rates that are valid today.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Visa fee</th><th className="px-4 py-3">Service fee</th><th className="px-4 py-3">Other</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Valid</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-2.5"><p className="font-medium text-slate-800">{v.name}</p><p className="text-xs text-slate-500">{v.category}</p></td>
                  <td className="px-4 py-2.5 text-slate-600">{formatMoney(v.visaFee, v.currency)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatMoney(v.serviceFee, v.currency)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatMoney(v.otherCharges, v.currency)}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{formatMoney(v.total, v.currency)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{formatDate(v.effectiveFrom)} – {v.effectiveTo ? formatDate(v.effectiveTo) : "open"}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATE_TONE[v.state]}>{v.state}</Badge></td>
                  <td className="px-4 py-2.5 text-right"><Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(v)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add visa rate" : "Edit visa rate"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="visa-form" loading={form.saving}>Save</Button></>}>
        <form id="visa-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={form.errors.name}><Input value={form.f.name} onChange={set("name")} invalid={!!form.errors.name} placeholder="e.g. Umrah visa" /></Field>
          <Field label="Category" required error={form.errors.category}><Input value={form.f.category} onChange={set("category")} invalid={!!form.errors.category} placeholder="e.g. Adult, Child, Infant" /></Field>
          <Field label={`Visa fee (${currency})`} required error={form.errors.visaFee}><Input type="number" min={0} value={form.f.visaFee} onChange={set("visaFee")} invalid={!!form.errors.visaFee} /></Field>
          <Field label="Service fee" error={form.errors.serviceFee}><Input type="number" min={0} value={form.f.serviceFee} onChange={set("serviceFee")} /></Field>
          <Field label="Other charges" error={form.errors.otherCharges}><Input type="number" min={0} value={form.f.otherCharges} onChange={set("otherCharges")} /></Field>
          <div />
          <Field label="Valid from" required error={form.errors.effectiveFrom}><Input type="date" value={form.f.effectiveFrom} onChange={set("effectiveFrom")} invalid={!!form.errors.effectiveFrom} /></Field>
          <Field label="Valid until" error={form.errors.effectiveTo} hint="Leave empty if open-ended"><Input type="date" value={form.f.effectiveTo} onChange={set("effectiveTo")} invalid={!!form.errors.effectiveTo} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={form.f.notes} onChange={set("notes")} className="min-h-16" /></Field>
          <Checkbox label="Active" checked={form.f.isActive} onChange={(e) => form.setF({ ...form.f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}
