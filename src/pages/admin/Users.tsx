import { Lock, Mail, Pencil, ShieldCheck, Trash2, Unlock, UserPlus, Users as UsersIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useMe } from "../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../utils/api";
import { timeAgo } from "../../utils/format";

interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  lockedUntil: string | null;
  invitationPending: boolean;
  mfaEnabled: boolean;
  roles: { code: string; name: string }[];
}

interface Role {
  id: string;
  code: string;
  name: string;
}

const EMPTY = { email: "", fullName: "", phone: "", roleCodes: [] as string[], status: "active" };

export function Users() {
  const me = useMe();
  const toast = useToast();
  const { data: users, loading, error, reload } = useApi<StaffUser[]>("/admin/users");
  const { data: roles } = useApi<Role[]>("/admin/roles");
  const [editing, setEditing] = useState<StaffUser | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<StaffUser | null>(null);
  const [removing, setRemoving] = useState(false);

  const staffRoles = (roles ?? []).filter((r) => r.code !== "TRAVEL_AGENT");

  const open = (u: StaffUser | "new") => {
    setErrors({});
    setForm(u === "new" ? EMPTY : { email: u.email, fullName: u.fullName, phone: u.phone ?? "", roleCodes: u.roles.map((r) => r.code), status: u.status });
    setEditing(u);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res =
        editing === "new"
          ? await api.post("/admin/users", { email: form.email, fullName: form.fullName, phone: form.phone, roleCodes: form.roleCodes })
          : await api.patch(`/admin/users/${(editing as StaffUser).id}`, { fullName: form.fullName, phone: form.phone, roleCodes: form.roleCodes, status: form.status });
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

  const act = async (path: string) => {
    try {
      const res = await api.post(path);
      toast("success", res.message ?? "Done");
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setRemoving(true);
    try {
      const res = await api.del(`/admin/users/${deleting.id}`);
      toast("success", res.message ?? "User deleted");
      setDeleting(null);
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setRemoving(false);
    }
  };

  const toggleRole = (code: string) =>
    setForm((f) => ({ ...f, roleCodes: f.roleCodes.includes(code) ? f.roleCodes.filter((c) => c !== code) : [...f.roleCodes, code] }));

  return (
    <div>
      <PageHeader
        title="Staff users"
        description="Internal team members. New users receive an email to set their password."
        actions={<Button icon={UserPlus} onClick={() => open("new")}>Invite user</Button>}
      />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Card className="overflow-hidden">
        {loading && !users ? (
          <Spinner />
        ) : !users?.length ? (
          <EmptyState icon={UsersIcon} title="No staff users" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last login</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const locked = !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{u.fullName} {u.id === me?.id && <span className="text-xs text-slate-400">(you)</span>}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.code} tone={r.code === "SUPER_ADMIN" ? "red" : "green"}>{r.name}</Badge>)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.invitationPending ? <Badge tone="amber">Invitation pending</Badge> : u.status === "active" ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}
                          {locked && <Badge tone="red"><Lock className="size-3" /> Locked</Badge>}
                          {u.mfaEnabled && <Badge tone="green"><ShieldCheck className="size-3" /> 2FA</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{timeAgo(u.lastLoginAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {u.invitationPending && <Button size="sm" variant="ghost" icon={Mail} onClick={() => act(`/admin/users/${u.id}/resend-invite`)}>Resend invite</Button>}
                          {locked && <Button size="sm" variant="ghost" icon={Unlock} onClick={() => act(`/admin/users/${u.id}/unlock`)}>Unlock</Button>}
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(u)}>Edit</Button>
                          {u.id !== me?.id && (
                            <Button size="sm" variant="ghost" icon={Trash2} className="text-accent-600 hover:bg-accent-50" onClick={() => setDeleting(u)} aria-label={`Delete ${u.fullName}`}>
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete staff user?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} loading={removing} onClick={confirmDelete}>Delete permanently</Button>
          </>
        }
      >
        {deleting && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              <b className="text-slate-900">{deleting.fullName}</b> ({deleting.email}) will lose access immediately and the account will be removed. This cannot be undone.
            </p>
            <p>Their past actions stay in the audit log under their email.</p>
            {!deleting.invitationPending && (
              <Alert tone="info">To block access but keep the account, use <b>Edit → Status: Disabled</b> instead.</Alert>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Invite staff user" : "Edit staff user"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="user-form" loading={saving}>{editing === "new" ? "Send invitation" : "Save"}</Button>
          </>
        }
      >
        <form id="user-form" onSubmit={save} className="space-y-4">
          <Field label="Full name" required error={errors.fullName}>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} invalid={!!errors.fullName} />
          </Field>
          <Field label="Email" required error={errors.email} hint={editing !== "new" ? "Email cannot be changed" : undefined}>
            <Input type="email" value={form.email} disabled={editing !== "new"} onChange={(e) => setForm({ ...form, email: e.target.value })} invalid={!!errors.email} />
          </Field>
          <Field label="Mobile" error={errors.phone}>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0300 1234567" invalid={!!errors.phone} />
          </Field>
          <Field label="Roles" required error={errors.roleCodes}>
            <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {staffRoles.map((r) => (
                <Checkbox key={r.code} label={r.name} checked={form.roleCodes.includes(r.code)} onChange={() => toggleRole(r.code)} />
              ))}
            </div>
          </Field>
          {editing !== "new" && (
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="disabled">Disabled (cannot log in)</option>
              </Select>
            </Field>
          )}
        </form>
      </Modal>
    </div>
  );
}
