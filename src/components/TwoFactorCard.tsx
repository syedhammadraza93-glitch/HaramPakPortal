import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi";
import { useAppDispatch } from "../redux/hooks";
import { refreshMe } from "../redux/slices/authSlice";
import { api, errorMessage, fieldErrors } from "../utils/api";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { Badge, Button, Card, CardHeader, Field, Input, Spinner } from "./ui";

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  /** Two-factor login is switched on for the portal (Settings → Security). */
  available: boolean;
}

/** Account page: emailed login codes (two-factor login). Required roles always have it on. */
export function TwoFactorCard() {
  const toast = useToast();
  const dispatch = useAppDispatch();
  const { data, loading, reload } = useApi<MfaStatus>("/auth/mfa");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.put("/auth/mfa", { enabled: !data.enabled, password });
      toast("success", res.message ?? "Saved");
      setOpen(false);
      setPassword("");
      await Promise.all([reload(), dispatch(refreshMe())]);
    } catch (err) {
      setError(fieldErrors(err).password ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="Two-factor login"
        description="A 6-digit code is emailed to you at every login, so a stolen password alone is not enough."
        actions={data && (data.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>)}
      />
      <div className="p-5">
        {loading && !data ? (
          <Spinner />
        ) : !data ? null : !data.available ? (
          <p className="text-sm text-slate-600">Two-factor login is switched off for the portal by the administrator.</p>
        ) : data.required ? (
          <p className="text-sm text-slate-600">Your role requires two-factor login, so it is always on.</p>
        ) : (
          <Button variant={data.enabled ? "secondary" : "primary"} icon={ShieldCheck} onClick={() => setOpen(true)}>
            {data.enabled ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={data?.enabled ? "Turn off two-factor login" : "Turn on two-factor login"} description="Confirm with your password.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Password" error={error}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!error} autoFocus />
          </Field>
          <Button type="submit" variant={data?.enabled ? "danger" : "primary"} loading={busy} className="w-full" disabled={!password}>
            {data?.enabled ? "Turn off" : "Turn on"}
          </Button>
        </form>
      </Modal>
    </Card>
  );
}
