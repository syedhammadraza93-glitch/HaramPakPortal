import { matchesHotel } from "../../../utils/hotelSearch";
import { FileCheck2, Hotel, MapPin, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { PAX_TYPES, VERTICALS, type Vertical } from "../../../utils/format";
import { StagesTab } from "./StagesTab";

type TabKey = "destinations" | "hotels" | "policies" | "documents" | "stages";

export function CatalogueSetup() {
  const [tab, setTab] = useState<TabKey>("destinations");
  const tabs: { key: TabKey; label: string }[] = [
    { key: "destinations", label: "Destinations" },
    { key: "hotels", label: "Hotels" },
    { key: "policies", label: "Cancellation policies" },
    { key: "documents", label: "Document checklist" },
    { key: "stages", label: "Booking stages" },
  ];
  return (
    <div>
      <PageHeader title="Catalogue setup" description="Destinations, hotels, cancellation policies and the documents passengers must provide." />
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "destinations" && <Destinations />}
      {tab === "hotels" && <Hotels />}
      {tab === "policies" && <Policies />}
      {tab === "documents" && <Documents />}
      {tab === "stages" && <StagesTab />}
    </div>
  );
}

/** Small CRUD helper: modal form state, save and delete with toasts. */
function useCrud(basePath: string, reload: () => Promise<void>) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (id: string | null, body: unknown) => {
    setSaving(true);
    setErrors({});
    try {
      const res = id ? await api.put(`${basePath}/${id}`, body) : await api.post(basePath, body);
      toast("success", res.message ?? "Saved");
      await reload();
      return true;
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      const res = await api.del(`${basePath}/${id}`);
      toast("success", res.message ?? "Deleted");
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };
  return { saving, errors, setErrors, save, remove };
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

const RowActions = ({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) => (
  <td className="px-4 py-2.5 text-right whitespace-nowrap">
    <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>Edit</Button>
    <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} aria-label="Delete" />
  </td>
);

// ---------------- Destinations ----------------
interface Destination { id: string; country: string; city: string; verticals: Vertical[]; description: string | null; isActive: boolean; sortOrder: number; hotelCount: number }

function Destinations() {
  const canManage = useCan("catalogue.manage");
  const { data, loading, reload } = useApi<Destination[]>("/admin/catalogue/destinations");
  const crud = useCrud("/admin/catalogue/destinations", reload);
  const [editing, setEditing] = useState<Destination | "new" | null>(null);
  const [f, setF] = useState({ country: "", city: "", verticals: [] as Vertical[], description: "", isActive: true, sortOrder: "0" });

  const open = (d: Destination | "new") => {
    crud.setErrors({});
    setF(d === "new" ? { country: "", city: "", verticals: [], description: "", isActive: true, sortOrder: "0" } : { country: d.country, city: d.city, verticals: d.verticals, description: d.description ?? "", isActive: d.isActive, sortOrder: String(d.sortOrder) });
    setEditing(d);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await crud.save(editing === "new" ? null : (editing as Destination).id, { ...f, sortOrder: Number(f.sortOrder) || 0, description: f.description || null })) setEditing(null);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex justify-end border-b border-slate-100 p-3">{canManage && <Button icon={Plus} onClick={() => open("new")}>Add destination</Button>}</div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={MapPin} title="No destinations">Add Makkah and Madinah for Umrah and Hajj, and the cities you sell tours to.</EmptyState>
      ) : (
        <Table head={["City", "Country", "Used for", "Hotels", "Status", ""]}>
          {data.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2.5 font-medium text-slate-800">{d.city}</td>
              <td className="px-4 py-2.5 text-slate-600">{d.country}</td>
              <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{d.verticals.map((v) => <Badge key={v} tone="green">{VERTICALS[v]}</Badge>)}</div></td>
              <td className="px-4 py-2.5 text-slate-600">{d.hotelCount}</td>
              <td className="px-4 py-2.5">{d.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              {canManage ? <RowActions onEdit={() => open(d)} onDelete={() => crud.remove(d.id, `${d.city}, ${d.country}`)} /> : <td />}
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add destination" : "Edit destination"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="dest-form" loading={crud.saving}>Save</Button></>}>
        <form id="dest-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="City" required error={crud.errors.city}><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} invalid={!!crud.errors.city} /></Field>
          <Field label="Country" required error={crud.errors.country}><Input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} invalid={!!crud.errors.country} /></Field>
          <Field label="Used for" required error={crud.errors.verticals} className="sm:col-span-2">
            <div className="flex flex-wrap gap-4">
              {(Object.keys(VERTICALS) as Vertical[]).map((v) => (
                <Checkbox key={v} label={VERTICALS[v]} checked={f.verticals.includes(v)} onChange={(e) => setF({ ...f, verticals: e.target.checked ? [...f.verticals, v] : f.verticals.filter((x) => x !== v) })} />
              ))}
            </div>
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-16" /></Field>
          <Field label="Display order"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
          <div className="flex items-end pb-2"><Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        </form>
      </Modal>
    </Card>
  );
}

// ---------------- Hotels ----------------
interface HotelRow { id: string; name: string; destinationId: string; city: string; country: string; starRating: number | null; distanceToHaramM: number | null; area: string | null; road: string | null; locationAliases: string | null; distanceReference: string | null; distanceVerifiedOn: string | null; shuttleAvailable: boolean | null; address: string | null; notes: string | null; isActive: boolean }

function Hotels() {
  const canManage = useCan("catalogue.manage");
  const { data, loading, reload } = useApi<HotelRow[]>("/admin/catalogue/hotels");
  const { data: dests } = useApi<Destination[]>("/admin/catalogue/destinations");
  const crud = useCrud("/admin/catalogue/hotels", reload);
  const [editing, setEditing] = useState<HotelRow | "new" | null>(null);
  const noFilters = { city: "", location: "", stars: [] as number[], min: "", max: "" };
  const [filters, setFilters] = useState(noFilters);
  const invalidRange = filters.min !== "" && filters.max !== "" && Number(filters.min) > Number(filters.max);
  const matches = invalidRange ? [] : (data ?? []).filter(h =>
    (!filters.city || h.destinationId === filters.city) && matchesHotel(h, filters),
  );
  const empty = { name: "", destinationId: "", starRating: "", distanceToHaramM: "", area: "", road: "", locationAliases: "", distanceReference: "", distanceVerifiedOn: "", shuttleAvailable: "", address: "", notes: "", isActive: true };
  const [f, setF] = useState(empty);

  const open = (h: HotelRow | "new") => {
    crud.setErrors({});
    setF(h === "new" ? empty : { name: h.name, destinationId: h.destinationId, starRating: h.starRating?.toString() ?? "", distanceToHaramM: h.distanceToHaramM?.toString() ?? "", area: h.area ?? "", road: h.road ?? "", locationAliases: h.locationAliases ?? "", distanceReference: h.distanceReference ?? "", distanceVerifiedOn: h.distanceVerifiedOn ?? "", shuttleAvailable: h.shuttleAvailable == null ? "" : String(h.shuttleAvailable), address: h.address ?? "", notes: h.notes ?? "", isActive: h.isActive });
    setEditing(h);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await crud.save(editing === "new" ? null : (editing as HotelRow).id, { ...f, distanceVerifiedOn: f.distanceVerifiedOn || null, shuttleAvailable: f.shuttleAvailable === "" ? null : f.shuttleAvailable === "true", address: f.address || null, notes: f.notes || null })) setEditing(null);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex justify-end border-b border-slate-100 p-3">{canManage && <Button icon={Plus} onClick={() => open("new")} disabled={!dests?.length}>Add hotel</Button>}</div>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="City"><Select value={filters.city} onChange={e => setFilters({ ...filters, city: e.target.value })}>
          <option value="">All cities</option>
          {(dests ?? []).map(d => <option key={d.id} value={d.id}>{d.city}</option>)}
        </Select></Field>
        <Field label="Area or road"><Input placeholder="e.g. Markaziyah" value={filters.location} onChange={e => setFilters({ ...filters, location: e.target.value })} /></Field>
        <Field label="Minimum walking distance (m)"><Input type="number" min={0} value={filters.min} onChange={e => setFilters({ ...filters, min: e.target.value })} /></Field>
        <Field label="Maximum walking distance (m)"><Input type="number" min={0} value={filters.max} onChange={e => setFilters({ ...filters, max: e.target.value })} /></Field>
        <fieldset className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <legend className="text-sm font-medium">Star ratings</legend>
          {[1, 2, 3, 4, 5, 6, 7].map(star => <Checkbox key={star} label={star + "★"} checked={filters.stars.includes(star)}
            onChange={e => setFilters({ ...filters, stars: e.target.checked ? [...filters.stars, star] : filters.stars.filter(value => value !== star) })} />)}
        </fieldset>
        <div className="self-end"><Button variant="secondary" onClick={() => setFilters(noFilters)}>Clear filters</Button></div>
        {invalidRange && <p role="alert" className="text-sm text-red-700 sm:col-span-2">Minimum distance must be at most the maximum distance.</p>}
      </div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={Hotel} title="No hotels">{dests?.length ? "Add the hotels used in your packages." : "Add a destination first."}</EmptyState>
      ) : !matches.length ? (
        <EmptyState icon={Hotel} title="No matching hotels">Try changing the area, rating, or walking distance.</EmptyState>
      ) : (
        <Table head={["Hotel", "City", "Area and road", "Stars", "Walking distance", "Status", ""]}>
          {matches.map((h) => (
            <tr key={h.id}>
              <td className="px-4 py-2.5 font-medium text-slate-800">{h.name}</td>
              <td className="px-4 py-2.5 text-slate-600">{h.city}, {h.country}</td>
              <td className="px-4 py-2.5 text-slate-600">{[h.area, h.road].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-4 py-2.5 text-slate-600">{h.starRating ? `${h.starRating}★` : "—"}</td>
              <td className="px-4 py-2.5 text-slate-600">{h.distanceToHaramM !== null ? `${h.distanceToHaramM} m` : "—"}{h.distanceToHaramM !== null && <span className="block text-xs">{h.distanceReference || "Landmark unspecified"} · {h.distanceVerifiedOn ? "Checked " + h.distanceVerifiedOn : "Unverified"}</span>}{h.shuttleAvailable && <span className="block text-xs">Shuttle available</span>}</td>
              <td className="px-4 py-2.5">{h.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              {canManage ? <RowActions onEdit={() => open(h)} onDelete={() => crud.remove(h.id, h.name)} /> : <td />}
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add hotel" : "Edit hotel"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="hotel-form" loading={crud.saving}>Save</Button></>}>
        <form id="hotel-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Hotel name" required error={crud.errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!crud.errors.name} /></Field>
          <Field label="City" required error={crud.errors.destinationId}>
            <Select value={f.destinationId} onChange={(e) => setF({ ...f, destinationId: e.target.value })} invalid={!!crud.errors.destinationId}>
              <option value="">Choose</option>
              {(dests ?? []).map((d) => <option key={d.id} value={d.id}>{d.city}, {d.country}</option>)}
            </Select>
          </Field>
          <Field label="Star rating" error={crud.errors.starRating}><Input type="number" min={1} max={7} value={f.starRating} onChange={(e) => setF({ ...f, starRating: e.target.value })} /></Field>
          <Field label="Walking distance (metres)" hint="Measure to the mosque or entrance specified below" error={crud.errors.distanceToHaramM}><Input type="number" min={0} value={f.distanceToHaramM} onChange={(e) => setF({ ...f, distanceToHaramM: e.target.value })} /></Field>
          <Field label="Area or neighbourhood" error={crud.errors.area}><Input maxLength={120} value={f.area} onChange={e => setF({ ...f, area: e.target.value })} /></Field>
          <Field label="Road" error={crud.errors.road}><Input maxLength={120} value={f.road} onChange={e => setF({ ...f, road: e.target.value })} /></Field>
          <Field label="Location aliases" hint="Alternate spellings, including Urdu" error={crud.errors.locationAliases}><Input maxLength={400} value={f.locationAliases} onChange={e => setF({ ...f, locationAliases: e.target.value })} /></Field>
          <Field label="Mosque or entrance" error={crud.errors.distanceReference}><Input maxLength={150} value={f.distanceReference} onChange={e => setF({ ...f, distanceReference: e.target.value })} /></Field>
          <Field label="Distance checked on" error={crud.errors.distanceVerifiedOn}><Input type="date" value={f.distanceVerifiedOn} onChange={e => setF({ ...f, distanceVerifiedOn: e.target.value })} /></Field>
          <Field label="Shuttle available" error={crud.errors.shuttleAvailable}><Select value={f.shuttleAvailable} onChange={e => setF({ ...f, shuttleAvailable: e.target.value })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></Select></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-16" /></Field>
          <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

// ---------------- Cancellation policies ----------------
interface Slab { daysBefore: number; chargeType: "percent" | "fixed"; chargeValue: number }
interface Policy { id: string; name: string; description: string | null; isActive: boolean; slabs: Slab[] }

export const describeSlab = (s: Slab, currency = "") =>
  `${s.daysBefore === 0 ? "On the departure day" : `${s.daysBefore} days or less before departure`}: ${s.chargeType === "percent" ? `${s.chargeValue}%` : `${currency} ${Number(s.chargeValue).toLocaleString("en-US")}`.trim()}`;

function Policies() {
  const canManage = useCan("catalogue.manage");
  const { data, loading, reload } = useApi<Policy[]>("/admin/catalogue/cancellation-policies");
  const crud = useCrud("/admin/catalogue/cancellation-policies", reload);
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  const [f, setF] = useState({ name: "", description: "", isActive: true, slabs: [] as { daysBefore: string; chargeType: "percent" | "fixed"; chargeValue: string }[] });

  const open = (p: Policy | "new") => {
    crud.setErrors({});
    setF(p === "new" ? { name: "", description: "", isActive: true, slabs: [{ daysBefore: "", chargeType: "percent", chargeValue: "" }] } : { name: p.name, description: p.description ?? "", isActive: p.isActive, slabs: p.slabs.map((s) => ({ daysBefore: String(s.daysBefore), chargeType: s.chargeType, chargeValue: String(s.chargeValue) })) });
    setEditing(p);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: f.name, description: f.description || null, isActive: f.isActive, slabs: f.slabs.filter((s) => s.daysBefore !== "" && s.chargeValue !== "").map((s) => ({ daysBefore: Number(s.daysBefore), chargeType: s.chargeType, chargeValue: Number(s.chargeValue) })) };
    if (await crud.save(editing === "new" ? null : (editing as Policy).id, body)) setEditing(null);
  };
  const setSlab = (i: number, patch: Partial<(typeof f.slabs)[number]>) => setF({ ...f, slabs: f.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <Card className="overflow-hidden">
      <div className="flex justify-end border-b border-slate-100 p-3">{canManage && <Button icon={Plus} onClick={() => open("new")}>Add policy</Button>}</div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={ScrollText} title="No cancellation policies">A policy lists the charge for cancelling a number of days before departure.</EmptyState>
      ) : (
        <Table head={["Policy", "Charges", "Status", ""]}>
          {data.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-2.5 align-top font-medium text-slate-800">{p.name}</td>
              <td className="px-4 py-2.5 text-slate-600"><ul>{p.slabs.length ? [...p.slabs].sort((a, b) => b.daysBefore - a.daysBefore).map((s) => <li key={s.daysBefore}>{describeSlab(s)}</li>) : <li>Free cancellation</li>}</ul></td>
              <td className="px-4 py-2.5 align-top">{p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              {canManage ? <RowActions onEdit={() => open(p)} onDelete={() => crud.remove(p.id, p.name)} /> : <td />}
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === "new" ? "Add cancellation policy" : "Edit cancellation policy"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="policy-form" loading={crud.saving}>Save</Button></>}>
        <form id="policy-form" onSubmit={submit} className="space-y-4">
          <Field label="Name" required error={crud.errors.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!crud.errors.name} /></Field>
          <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-16" /></Field>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Charges <span className="font-normal text-slate-500">(the closest slab applies; no slab means free cancellation)</span></p>
            {crud.errors.slabs && <p className="text-xs text-accent-600">{crud.errors.slabs}</p>}
            {f.slabs.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input type="number" min={0} value={s.daysBefore} onChange={(e) => setSlab(i, { daysBefore: e.target.value })} placeholder="Days before" aria-label="Days before departure" />
                <Select value={s.chargeType} onChange={(e) => setSlab(i, { chargeType: e.target.value as "percent" | "fixed" })}>
                  <option value="percent">% of price</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
                <Input type="number" min={0} value={s.chargeValue} onChange={(e) => setSlab(i, { chargeValue: e.target.value })} placeholder="Charge" aria-label="Charge" />
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setF({ ...f, slabs: f.slabs.filter((_, j) => j !== i) })} aria-label="Remove slab" />
              </div>
            ))}
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setF({ ...f, slabs: [...f.slabs, { daysBefore: "", chargeType: "percent", chargeValue: "" }] })}>Add slab</Button>
          </div>
          <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

// ---------------- Document checklist ----------------
interface DocReq { id: string; vertical: Vertical; packageId: string | null; name: string; description: string | null; isRequired: boolean; appliesTo: string; sortOrder: number; isActive: boolean }

function Documents() {
  const canManage = useCan("catalogue.manage");
  const [vertical, setVertical] = useState<Vertical>("umrah");
  const { data, loading, reload } = useApi<DocReq[]>("/admin/catalogue/document-requirements", { vertical });
  const crud = useCrud("/admin/catalogue/document-requirements", reload);
  const [editing, setEditing] = useState<DocReq | "new" | null>(null);
  const [f, setF] = useState({ name: "", description: "", isRequired: true, appliesTo: "all", sortOrder: "0", isActive: true });

  const open = (d: DocReq | "new") => {
    crud.setErrors({});
    setF(d === "new" ? { name: "", description: "", isRequired: true, appliesTo: "all", sortOrder: String(data?.length ?? 0), isActive: true } : { name: d.name, description: d.description ?? "", isRequired: d.isRequired, appliesTo: d.appliesTo, sortOrder: String(d.sortOrder), isActive: d.isActive });
    setEditing(d);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await crud.save(editing === "new" ? null : (editing as DocReq).id, { ...f, vertical, description: f.description || null, sortOrder: Number(f.sortOrder) || 0 })) setEditing(null);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
        <Select value={vertical} onChange={(e) => setVertical(e.target.value as Vertical)} className="w-56">
          {Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {canManage && <Button icon={Plus} onClick={() => open("new")}>Add document</Button>}
      </div>
      {loading && !data ? <Spinner /> : !data?.length ? (
        <EmptyState icon={FileCheck2} title="No documents in the checklist">Passengers will be asked for these documents when booking.</EmptyState>
      ) : (
        <Table head={["Document", "For", "Required", "Status", ""]}>
          {data.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2.5"><p className="font-medium text-slate-800">{d.name}</p>{d.description && <p className="text-xs text-slate-500">{d.description}</p>}</td>
              <td className="px-4 py-2.5 text-slate-600">{d.appliesTo === "all" ? "All passengers" : PAX_TYPES[d.appliesTo]}</td>
              <td className="px-4 py-2.5">{d.isRequired ? <Badge tone="amber">Required</Badge> : <Badge>Optional</Badge>}</td>
              <td className="px-4 py-2.5">{d.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              {canManage ? <RowActions onEdit={() => open(d)} onDelete={() => crud.remove(d.id, d.name)} /> : <td />}
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing === "new" ? "Add" : "Edit"} document · ${VERTICALS[vertical]}`} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="doc-form" loading={crud.saving}>Save</Button></>}>
        <form id="doc-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Document" required error={crud.errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!crud.errors.name} placeholder="e.g. Passport copy (valid 6+ months)" /></Field>
          <Field label="Instructions" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-16" /></Field>
          <Field label="For">
            <Select value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value })}>
              <option value="all">All passengers</option>
              {Object.entries(PAX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Display order"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
          <Checkbox label="Required" checked={f.isRequired} onChange={(e) => setF({ ...f, isRequired: e.target.checked })} />
          <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}
