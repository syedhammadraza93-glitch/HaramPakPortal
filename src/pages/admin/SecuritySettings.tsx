import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "../../components/Toast";
import { Button, Card, CardHeader, Checkbox, Spinner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useAppDispatch } from "../../redux/hooks";
import { refreshMe } from "../../redux/slices/authSlice";
import { api, errorMessage } from "../../utils/api";

interface Security {
  twoFactorEnabled: boolean;
  twoFactorRoles: string[];
  roles: { code: string; name: string }[];
}

/** Settings → Security: switch two-factor login (emailed code) on or off, and choose the roles that must use it. */
export function SecuritySettingsCard() {
  const toast = useToast();
  const dispatch = useAppDispatch();
  const { data } = useApi<Security>("/admin/settings/security");
  const [enabled, setEnabled] = useState(true);
  const [required, setRequired] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setEnabled(data.twoFactorEnabled);
      setRequired(data.twoFactorRoles);
    }
  }, [data]);

  const toggleRole = (code: string, on: boolean) => setRequired((r) => (on ? [...r, code] : r.filter((c) => c !== code)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put("/admin/settings/security", { twoFactorEnabled: enabled, twoFactorRoles: required });
      toast("success", res.message ?? "Saved");
      await dispatch(refreshMe());
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={ShieldCheck} title="Security" description="Two-factor login: a 6-digit code is emailed at every login, so a stolen password alone is not enough." />
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-4 p-5">
          <Checkbox label="Use two-factor login (emailed code)" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {enabled ? (
            <div>
              <p className="text-sm font-medium text-slate-800">Required for these roles</p>
              <p className="mb-3 text-xs text-slate-500">Users with other roles can turn it on for themselves under My account.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.roles.map((r) => (
                  <Checkbox key={r.code} label={r.name} checked={required.includes(r.code)} onChange={(e) => toggleRole(r.code, e.target.checked)} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Off: nobody is asked for a code at login, including users who turned it on for themselves.</p>
          )}
          <Button loading={saving} onClick={save}>Save security settings</Button>
        </div>
      )}
    </Card>
  );
}
