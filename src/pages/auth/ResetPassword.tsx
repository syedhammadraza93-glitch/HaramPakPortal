import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useBranding } from "../../branding/BrandingProvider";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthCard, AuthLayout } from "../../layout/AuthLayout";
import { api, errorMessage, fieldErrors } from "../../utils/api";

/** Staff invitation link (/reset-password?token=…&invite=1): the new staff member chooses a password. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const branding = useBranding();
  const token = params.get("token") ?? "";
  const invite = params.get("invite") === "1";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrors({});
    setLoading(true);
    try {
      const res = await api.post("/auth/accept-invite", { token, password, confirmPassword });
      setDone(res.message ?? "Password set");
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!fe.password && !fe.confirmPassword) setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard title="Set up your account" subtitle={`Welcome to the ${branding.name} admin portal. Choose a password to activate your account.`}>
        {!token || !invite ? (
          <div className="space-y-4">
            <Alert tone="info">Password reset now works with a 6-digit code sent to your email.</Alert>
            <Link to="/forgot-password" className="block rounded-lg bg-brand-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700">
              Reset my password
            </Link>
          </div>
        ) : done ? (
          <div className="space-y-4">
            <Alert tone="success" icon={CheckCircle2}>{done}</Alert>
            <Link to="/login" className="block rounded-lg bg-brand-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700">Go to login</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="New password" error={errors.password} hint="At least 8 characters with a letter and a number" htmlFor="password">
              <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} autoFocus />
            </Field>
            <Field label="Confirm password" error={errors.confirmPassword} htmlFor="confirm">
              <Input id="confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} invalid={!!errors.confirmPassword} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!password || !confirmPassword}>Activate account</Button>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
