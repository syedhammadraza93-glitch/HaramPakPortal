import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, Textarea } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../utils/api";
import { formatDateTime } from "../../utils/format";

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "all" | "agencies" | "pricing_groups";
  agencyIds: string[];
  pricingGroupIds: string[];
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  sendEmail: boolean;
  notifiedAt: string | null;
  createdByName: string | null;
  recipients: number;
}
interface Options {
  agencies: { id: string; agencyName: string; agentCode: string | null }[];
  pricingGroups: { id: string; name: string; code: string }[];
}

/** <input type="datetime-local"> value in local time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const AUDIENCE = { all: "All agencies", agencies: "Selected agencies", pricing_groups: "Pricing groups" };

export function Announcements() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useApi<{ items: Announcement[]; total: number; page: number; pageSize: number }>("/admin/announcements", { page, pageSize: 20 });
  const { data: opts } = useApi<Options>("/admin/announcements/options");
  const empty = { title: "", body: "", audience: "all" as Announcement["audience"], agencyIds: [] as string[], pricingGroupIds: [] as string[], startsAt: "", endsAt: "", sendEmail: false, isActive: true };
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [agencySearch, setAgencySearch] = useState("");

  const open = (a: Announcement | "new") => {
    setErrors({});
    setAgencySearch("");
    setF(a === "new" ? empty : { title: a.title, body: a.body, audience: a.audience, agencyIds: a.agencyIds, pricingGroupIds: a.pricingGroupIds, startsAt: toLocalInput(a.startsAt), endsAt: toLocalInput(a.endsAt), sendEmail: a.sendEmail, isActive: a.isActive });
    setEditing(a);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const body = { ...f, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null };
    try {
      const res = editing === "new" ? await api.post("/admin/announcements", body) : await api.put(`/admin/announcements/${(editing as Announcement).id}`, body);
      toast("success", res.message ?? "Saved");
      setEditing(null);
      void reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Announcement) => {
    if (!window.confirm(`Remove "${a.title}"? Agents will no longer see it.`)) return;
    try {
      await api.del(`/admin/announcements/${a.id}`);
      void reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const now = Date.now();
  const filteredAgencies = (opts?.agencies ?? []).filter((a) => !agencySearch || `${a.agencyName} ${a.agentCode ?? ""}`.toLowerCase().includes(agencySearch.toLowerCase()));

  return (
    <div>
      <PageHeader title="Announcements" description="Messages shown on agent dashboards, with a portal notification and optional email." actions={<Button icon={Plus} onClick={() => open("new")}>New announcement</Button>} />
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={Megaphone} title="No announcements yet" /> : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((a) => {
                const live = a.isActive && new Date(a.startsAt).getTime() <= now && (!a.endsAt || new Date(a.endsAt).getTime() > now);
                const scheduled = a.isActive && new Date(a.startsAt).getTime() > now;
                return (
                  <li key={a.id} className="flex flex-wrap items-start gap-4 p-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{a.title}</p>
                        {live ? <Badge tone="green">Showing</Badge> : scheduled ? <Badge tone="blue">Scheduled</Badge> : <Badge tone="slate">{a.isActive ? "Ended" : "Hidden"}</Badge>}
                        {a.sendEmail && <Badge tone="slate">Email</Badge>}
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-slate-600">{a.body}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {AUDIENCE[a.audience]} · {a.recipients} agencies · from {formatDateTime(a.startsAt)}{a.endsAt ? ` to ${formatDateTime(a.endsAt)}` : ""} · {a.createdByName}
                        {a.notifiedAt ? ` · notified ${formatDateTime(a.notifiedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(a)} aria-label="Edit" />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(a)} aria-label="Remove" />
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing === "new" ? "New announcement" : "Edit announcement"}
        description={editing !== "new" && editing?.notifiedAt ? "Agents were already notified; saving changes what they see but does not notify them again." : "Agents are notified when it starts."}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="ann-form" loading={saving}>{editing === "new" ? "Publish" : "Save"}</Button></>}>
        <form id="ann-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} invalid={!!errors.title} /></Field>
          <Field label="Message" required error={errors.body} className="sm:col-span-2"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="min-h-28" invalid={!!errors.body} /></Field>
          <Field label="Send to" className="sm:col-span-2">
            <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as Announcement["audience"] })}>
              {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {f.audience === "agencies" && (
            <Field label={`Agencies (${f.agencyIds.length} chosen)`} error={errors.agencyIds} className="sm:col-span-2">
              <Input placeholder="Search agencies" value={agencySearch} onChange={(e) => setAgencySearch(e.target.value)} />
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {filteredAgencies.map((a) => <Checkbox key={a.id} label={`${a.agencyName}${a.agentCode ? ` (${a.agentCode})` : ""}`} checked={f.agencyIds.includes(a.id)} onChange={() => setF({ ...f, agencyIds: toggle(f.agencyIds, a.id) })} />)}
                {!filteredAgencies.length && <p className="text-sm text-slate-500">No active agencies match.</p>}
              </div>
            </Field>
          )}
          {f.audience === "pricing_groups" && (
            <Field label="Pricing groups" error={errors.pricingGroupIds} className="sm:col-span-2">
              <div className="space-y-1 rounded-lg border border-slate-200 p-2">
                {(opts?.pricingGroups ?? []).map((g) => <Checkbox key={g.id} label={`${g.name} (${g.code})`} checked={f.pricingGroupIds.includes(g.id)} onChange={() => setF({ ...f, pricingGroupIds: toggle(f.pricingGroupIds, g.id) })} />)}
                {!opts?.pricingGroups.length && <p className="text-sm text-slate-500">No pricing groups yet.</p>}
              </div>
            </Field>
          )}
          <Field label="Show from" hint="Empty = now"><Input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label="Show until" hint="Empty = until removed" error={errors.endsAt}><Input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
          <Checkbox label="Also email the agencies" checked={f.sendEmail} disabled={editing !== "new" && !!editing?.notifiedAt} onChange={(e) => setF({ ...f, sendEmail: e.target.checked })} />
          <Checkbox label="Show on agent dashboards" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </form>
      </Modal>
    </div>
  );
}
