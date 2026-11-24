import { ArrowLeft, Eye, EyeOff, LogIn, MailCheck, MailWarning, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useBranding } from "../../branding/BrandingProvider";
import { CodeInput, useCooldown } from "../../components/CodeInput";
import { useToast } from "../../components/Toast";
import { Alert, Button, Field, Input } from "../../components/ui";
import { AuthCard, AuthLayout } from "../../layout/AuthLayout";
import { useAppDispatch } from "../../redux/hooks";
import { login, loginMfa } from "../../redux/slices/authSlice";
import { homeFor } from "../../routes/ProtectedRoute";
import { api, errorMessage, type Me } from "../../utils/api";

export function Login() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const branding = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Second step: 6-digit code emailed to the user
  const [mfa, setMfa] = useState<{ token: string; sentTo: string } | null>(null);
  const [code, setCode] = useState("");
  const [resending, setResending] = useState(false);
  const cooldown = useCooldown(0);

  const goHome = (user: Me) => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from.startsWith(homeFor(user.type)) ? from : homeFor(user.type), { replace: true });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await dispatch(login({ email, password })).unwrap();
      if (result.mfa) {
        setMfa(result.mfa);
        setCode("");
        cooldown.restart();
      } else if (result.user) {
        goHome(result.user);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onSubmitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    setError(null);
    setLoading(true);
    try {
      goHome(await dispatch(loginMfa({ mfaToken: mfa.token, code })).unwrap());
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      // The login step expired or the account got locked: start again with the password.
      if (/expired\. Please enter your password|log in again|locked/i.test(message)) setMfa(null);
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (!mfa) return;
    setResending(true);
    setError(null);
    try {
      const res = await api.post<{ mfaToken: string; sentTo: string }>("/auth/login/mfa/resend", { mfaToken: mfa.token });
      setMfa({ token: res.data.mfaToken, sentTo: res.data.sentTo });
      setCode("");
      cooldown.restart();
      toast("success", res.message ?? "A new code has been sent");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const needsVerification = !!error && /verify your email/i.test(error);

  if (mfa) {
    return (
      <AuthLayout>
        <AuthCard title="Enter your login code" subtitle="For your security, we emailed you a 6-digit code. It is valid for 10 minutes.">
          <form onSubmit={onSubmitCode} className="space-y-4" noValidate>
            <Alert tone="success" icon={MailCheck}>
              Code sent to <b>{mfa.sentTo}</b>. Check your spam folder if you do not see it.
            </Alert>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Login code">
              <CodeInput value={code} onChange={setCode} invalid={!!error} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading} icon={ShieldCheck} disabled={code.length !== 6}>
              Verify and log in
            </Button>
          </form>
          <div className="mt-6 flex items-center justify-between text-sm">
            <button onClick={() => { setMfa(null); setError(null); }} className="inline-flex items-center gap-1 text-slate-500 hover:text-brand-700">
              <ArrowLeft className="size-4" /> Back
            </button>
            <button onClick={resendCode} disabled={resending || cooldown.left > 0} className="font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
              {cooldown.left > 0 ? `Send a new code in ${cooldown.left}s` : resending ? "Sending…" : "Send a new code"}
            </button>
          </div>
        </AuthCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthCard title="Welcome back" subtitle={`Log in to the ${branding.name} ${branding.portalName}.`}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert tone={needsVerification ? "warning" : "error"} icon={needsVerification ? MailWarning : undefined}>
              {error}
              {needsVerification && (
                <Link to={`/verify-email?email=${encodeURIComponent(email)}`} className="mt-1 block font-semibold underline">
                  Enter verification code
                </Link>
              )}
            </Alert>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field
            label={
              <span className="flex justify-between">
                Password
                <Link to="/forgot-password" className="font-normal text-brand-700 hover:underline">
                  Forgot password?
                </Link>
              </span>
            }
            htmlFor="password"
          >
            <div className="relative">
              <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
              <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600" aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={loading} icon={LogIn} disabled={!email || !password}>
            Log in
          </Button>
        </form>
        <div className="mt-6 rounded-lg bg-brand-50 px-4 py-3 text-center text-sm text-brand-800">
          New travel agency?{" "}
          <Link to="/register" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
            Register as an agent
          </Link>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}
