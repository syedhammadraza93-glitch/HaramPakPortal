import { KeyRound, LogOut, Monitor } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../components/Toast";
import { TwoFactorCard } from "../../components/TwoFactorCard";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Spinner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useAppDispatch, useMe } from "../../redux/hooks";
import { logout } from "../../redux/slices/authSlice";
import { api, errorMessage, fieldErrors, setSession, type Session } from "../../utils/api";
import { describeDevice, formatDateTime } from "../../utils/format";

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  current: boolean;
}

export function Security() {
  const me = useMe();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const sessions = useApi<SessionRow[]>("/auth/sessions");
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setSaving(true);
    try {
      const res = await api.post<Session>("/auth/change-password", form);
      setSession(res.data);
      toast("success", "Password changed. Your other devices were logged out.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      void sessions.reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.del(`/auth/sessions/${id}`);
      toast("success", "Device logged out");
      void sessions.reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const logoutAll = async () => {
    try {
      await api.post("/auth/logout-all");
    } finally {
      await dispatch(logout());
      navigate("/login", { replace: true });
    }
  };

  const input = (key: keyof typeof form, label: string, autoComplete: string) => (
    <Field label={label} error={errors[key]}>
      <Input type="password" autoComplete={autoComplete} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} invalid={!!errors[key]} />
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Account & security" description={`${me?.fullName} · ${me?.email}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <TwoFactorCard />
        </div>
        <Card>
          <CardHeader icon={KeyRound} title="Change password" description="At least 8 characters with a letter and a number." />
          <form onSubmit={change} className="space-y-4 p-5">
            {input("currentPassword", "Current password", "current-password")}
            {input("newPassword", "New password", "new-password")}
            {input("confirmPassword", "Confirm new password", "new-password")}
            <Button type="submit" loading={saving} disabled={!form.currentPassword || !form.newPassword}>Change password</Button>
          </form>
        </Card>

        <Card>
          <CardHeader
            icon={Monitor}
            title="Logged-in devices"
            actions={<Button size="sm" variant="secondary" icon={LogOut} onClick={logoutAll}>Log out everywhere</Button>}
          />
          {sessions.loading && !sessions.data ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(sessions.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <Monitor className="size-5 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      {describeDevice(s.userAgent)} {s.current && <Badge tone="green">This device</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">Since {formatDateTime(s.createdAt)}{s.ip ? ` · ${s.ip}` : ""}</p>
                  </div>
                  {!s.current && <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>Log out</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
