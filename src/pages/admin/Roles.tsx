import { Lock, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Spinner, Textarea } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../utils/api";

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  locked: boolean;
  userCount: number;
  permissions: string[];
}

interface Permission {
  code: string;
  module: string;
  description: string;
}

const EMPTY = { code: "", name: "", description: "", permissions: [] as string[] };

export function Roles() {
  const toast = useToast();
  const { data: roles, loading, error, reload } = useApi<Role[]>("/admin/roles");
  const { data: perms } = useApi<Permission[]>("/admin/permissions");
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const staffPerms = (perms ?? []).filter((p) => p.code !== "portal.agent");
  const modules = [...new Set(staffPerms.map((p) => p.module))];
  const readOnly = editing !== "new" && !!editing?.locked;

  const open = (r: Role | "new") => {
    setErrors({});
    setForm(r === "new" ? EMPTY : { code: r.code, name: r.name, description: r.description ?? "", permissions: r.permissions });
    setEditing(r);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res =
        editing === "new"
          ? await api.post("/admin/roles", form)
          : await api.patch(`/admin/roles/${(editing as Role).id}`, { name: form.name, description: form.description, permissions: form.permissions });
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

  const toggle = (code: string) =>
    setForm((f) => ({ ...f, permissions: f.permissions.includes(code) ? f.permissions.filter((c) => c !== code) : [...f.permissions, code] }));

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Group permissions into roles, then give roles to staff users. Built-in Super Admin and Travel Agent roles are fixed."
        actions={<Button icon={Plus} onClick={() => open("new")}>New role</Button>}
      />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {loading && !roles ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(roles ?? []).map((r) => (
            <Card key={r.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-brand-50 p-2 text-brand-700"><ShieldCheck className="size-4" /></div>
                  <div>
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    <p className="font-mono text-xs text-slate-400">{r.code}</p>
                  </div>
                </div>
                {r.locked && <Badge><Lock className="size-3" /> Built-in</Badge>}
              </div>
              <p className="mt-3 flex-1 text-sm text-slate-500">{r.description}</p>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-500">{r.permissions.length} permissions · {r.userCount} user{r.userCount === 1 ? "" : "s"}</span>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(r)}>{r.locked ? "View" : "Edit"}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New role" : readOnly ? form.name : "Edit role"}
        size="lg"
        footer={
          readOnly ? (
            <Button variant="secondary" onClick={() => setEditing(null)}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" form="role-form" loading={saving}>Save role</Button>
            </>
          )
        }
      >
        <form id="role-form" onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name}>
              <Input value={form.name} disabled={readOnly} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} />
            </Field>
            <Field label="Code" required error={errors.code} hint={editing === "new" ? "e.g. VISA_OFFICER" : undefined}>
              <Input value={form.code} disabled={editing !== "new"} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} invalid={!!errors.code} />
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={form.description} disabled={readOnly} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-16" />
          </Field>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">Permissions</p>
            {modules.map((m) => (
              <div key={m} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{m}</p>
                <div className="grid gap-2">
                  {staffPerms.filter((p) => p.module === m).map((p) => (
                    <Checkbox
                      key={p.code}
                      disabled={readOnly}
                      checked={form.permissions.includes(p.code)}
                      onChange={() => toggle(p.code)}
                      label={<><span className="font-mono text-xs text-slate-500">{p.code}</span> · {p.description}</>}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </form>
      </Modal>
    </div>
  );
}
