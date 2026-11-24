import { CheckCircle2, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CodeInput, useCooldown } from "../../components/CodeInput";
import { useToast } from "../../components/Toast";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthCard, AuthLayout } from "../../layout/AuthLayout";
import { api, errorMessage, fieldErrors } from "../../utils/api";

/** Agent enters the 6-digit code emailed after sign-up. */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const toast = useToast();
  const isNew = params.get("new") === "1";
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const cooldown = useCooldown(isNew ? 30 : 0);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post("/auth/verify-email", { email, code });
      setDone(res.message ?? "Email verified");
    } catch (err) {
      const fe = fieldErrors(err);
      setError(fe.code ?? fe.email ?? errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await api.post("/auth/resend-verification", { email });
      toast("success", res.message ?? "A new code has been sent");
      cooldown.restart();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard title={done ? "Email verified" : "Verify your email"} subtitle={done ? undefined : "Enter the 6-digit code we emailed you. It is valid for 10 minutes."}>
        {done ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-fit rounded-full bg-brand-50 p-4 text-brand-600">
              <CheckCircle2 className="size-8" />
            </div>
            <p className="text-slate-700">{done}</p>
            <p className="text-sm text-slate-500">You can log in to follow your application. We will email you when it is approved.</p>
            <Link to="/login" className="inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
              Go to login
            </Link>
          </div>
        ) : (
          <form onSubmit={verify} className="space-y-4" noValidate>
            {isNew && (
              <Alert tone="success" icon={MailCheck}>
                Registration received. We sent a code to <b>{email}</b>. Check your spam folder if you do not see it.
              </Alert>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            {!isNew && (
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            )}
            <Field label="Verification code">
              <CodeInput value={code} onChange={setCode} invalid={!!error} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!email || code.length !== 6}>
              Verify email
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={resend} loading={sending} disabled={!email || cooldown.left > 0}>
              {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : "Send a new code"}
            </Button>
            <p className="text-center text-sm">
              <Link to="/login" className="font-semibold text-brand-700 hover:underline">Back to login</Link>
            </p>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  );
}
