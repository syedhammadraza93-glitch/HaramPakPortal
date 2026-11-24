import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CodeInput, useCooldown } from "../../components/CodeInput";
import { useToast } from "../../components/Toast";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthCard, AuthLayout } from "../../layout/AuthLayout";
import { api, errorMessage, fieldErrors } from "../../utils/api";

/** Step 1: email → a 6-digit code is emailed. Step 2: code + new password. */
export function ForgotPassword() {
  const toast = useToast();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cooldown = useCooldown(0);

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setStep("code");
      cooldown.restart();
      if (!e) toast("success", "A new code has been sent");
    } catch (err) {
      setError(fieldErrors(err).email ?? errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrors({});
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { email, code, password, confirmPassword });
      setStep("done");
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!fe.password && !fe.confirmPassword && !fe.code) setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard
        title={step === "done" ? "Password changed" : "Forgot your password?"}
        subtitle={
          step === "email"
            ? "Enter your email and we will send you a 6-digit code."
            : step === "code"
              ? <>If an account exists for <b>{email}</b>, we sent a code to it. It is valid for 10 minutes.</>
              : undefined
        }
      >
        {step === "done" ? (
          <div className="space-y-4">
            <Alert tone="success" icon={CheckCircle2}>Your password has been changed and your other devices were logged out.</Alert>
            <Link to="/login" className="block rounded-lg bg-brand-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700">Go to login</Link>
          </div>
        ) : step === "email" ? (
          <form onSubmit={requestCode} className="space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!email}>Send code</Button>
          </form>
        ) : (
          <form onSubmit={reset} className="space-y-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Code from the email" error={errors.code}>
              <CodeInput value={code} onChange={setCode} invalid={!!errors.code} />
            </Field>
            <Field label="New password" error={errors.password} hint="At least 8 characters with a letter and a number" htmlFor="password">
              <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} />
            </Field>
            <Field label="Confirm new password" error={errors.confirmPassword} htmlFor="confirm">
              <Input id="confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} invalid={!!errors.confirmPassword} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading} disabled={code.length !== 6 || !password || !confirmPassword}>Change password</Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => void requestCode()} disabled={cooldown.left > 0 || loading}>
              {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : "Send a new code"}
            </Button>
          </form>
        )}
        {step !== "done" && (
          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">Back to login</Link>
          </p>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
