import { Building2, FileText, KeyRound, MapPin, Paperclip, Send, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Turnstile } from "../../components/Turnstile";
import { Alert, Button, Checkbox, Field, Input, Spinner } from "../../components/ui";
import { AuthLayout } from "../../layout/AuthLayout";
import { ApiError, api, errorMessage, fieldErrors } from "../../utils/api";
import { useBranding } from "../../branding/BrandingProvider";
import { formatBytes } from "../../utils/format";

interface RegField {
  field: string;
  label: string;
  kind: "text" | "file";
  mode: "required" | "optional" | "hidden";
}

const MAX_FILE = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const PLACEHOLDERS: Record<string, string> = { cnic: "35202-1234567-1", ntn: "1234567-8", businessRegNo: "e.g. 0123456", licenceNo: "e.g. DTS-1234" };

function Section({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
        <Icon className="size-4 text-brand-600" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function FilePicker({ id, file, onChange, invalid }: { id: string; file: File | null; onChange: (f: File | null) => void; invalid?: boolean }) {
  return file ? (
    <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
      <Paperclip className="size-4 text-brand-600" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
      <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-accent-600" aria-label="Remove file">
        <X className="size-4" />
      </button>
    </div>
  ) : (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-slate-500 hover:border-brand-400 hover:bg-brand-50/50 ${invalid ? "border-accent-500" : "border-slate-300"}`}
    >
      <Paperclip className="size-4" /> Choose PDF, JPG or PNG (max 5 MB)
      <input id={id} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}

export function Register() {
  const navigate = useNavigate();
  const branding = useBranding();
  const [fields, setFields] = useState<RegField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ country: "Pakistan" });
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [others, setOthers] = useState<File[]>([]);
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captchaKey, setCaptchaKey] = useState<string | null | undefined>(undefined);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    api.get<RegField[]>("/public/registration-fields").then(setFields).catch((e) => setLoadError(errorMessage(e)));
    api.get<{ captchaSiteKey: string | null }>("/public/config").then((c) => setCaptchaKey(c.captchaSiteKey)).catch(() => setCaptchaKey(null));
  }, []);

  const set = (name: string) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const text = (name: string, label: string, props: Record<string, unknown> = {}, required = true) => (
    <Field label={label} required={required} error={errors[name]} htmlFor={name}>
      <Input id={name} name={name} value={values[name] ?? ""} onChange={set(name)} invalid={!!errors[name]} {...props} />
    </Field>
  );

  const pickFile = (name: string) => (f: File | null) => {
    if (f && f.size > MAX_FILE) {
      setErrors((e) => ({ ...e, [name]: "File is larger than 5 MB" }));
      return;
    }
    setErrors(({ [name]: _removed, ...rest }) => rest);
    setFiles((v) => ({ ...v, [name]: f }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setErrors({});
    const form = new FormData();
    const all = { ...values, whatsapp: sameWhatsapp ? values.phone ?? "" : values.whatsapp ?? "", acceptTerms: terms ? "true" : "false" };
    Object.entries(all).forEach(([k, v]) => form.append(k, v));
    Object.entries(files).forEach(([k, f]) => f && form.append(k, f));
    others.forEach((f) => form.append("otherDocs", f));
    if (captchaToken) form.append("captchaToken", captchaToken);

    setSubmitting(true);
    try {
      const res = await api.postForm<{ email: string }>("/public/agent-registrations", form);
      navigate(`/verify-email?new=1&email=${encodeURIComponent(res.data.email)}`, { replace: true });
    } catch (err) {
      const fe = fieldErrors(err);
      if (sameWhatsapp && fe.whatsapp && !fe.phone) fe.phone = fe.whatsapp;
      setErrors(fe);
      setFormError(err instanceof ApiError && err.errors ? `${err.message}. ${Object.keys(fe).length} field(s) need attention.` : errorMessage(err));
      // A CAPTCHA token works only once, so get a fresh one for the next try.
      if (captchaKey) setCaptchaReset((n) => n + 1);
      if (!fe.captcha) window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  const visible = (fields ?? []).filter((f) => f.mode !== "hidden");

  return (
    <AuthLayout wide>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-500">Agent registration</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">Register your travel agency</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            After you verify your email, our team reviews your application. You will receive your Agent ID by email once approved.
          </p>
        </div>

        {loadError && <Alert tone="error">{loadError}</Alert>}
        {!fields && !loadError && <Spinner />}

        {fields && (
          <form onSubmit={onSubmit} className="space-y-8" noValidate>
            {formError && <Alert tone="error">{formError}</Alert>}

            <Section icon={Building2} title="Agency details">
              {text("agencyName", "Agency / business name", { placeholder: "e.g. Al-Madina Travels" })}
              {text("authorizedPerson", "Authorized person (full name)")}
              {text("email", "Email (used to log in)", { type: "email", autoComplete: "email" })}
              {text("phone", "Mobile number", { type: "tel", placeholder: "0300 1234567", autoComplete: "tel" })}
              <div className="sm:col-span-2 space-y-3">
                <Checkbox label="WhatsApp number is the same as mobile number" checked={sameWhatsapp} onChange={(e) => setSameWhatsapp(e.target.checked)} />
                {!sameWhatsapp && <div className="sm:w-1/2 sm:pr-2">{text("whatsapp", "WhatsApp number", { type: "tel", placeholder: "0300 1234567" })}</div>}
              </div>
            </Section>

            <Section icon={MapPin} title="Address">
              <div className="sm:col-span-2">{text("address", "Office address", { placeholder: "Office no., building, street, area" })}</div>
              <Field label="City" required error={errors.city} htmlFor="city">
                <Input id="city" list="cities" value={values.city ?? ""} onChange={set("city")} invalid={!!errors.city} placeholder="Start typing…" />
                <datalist id="cities">
                  {branding.cities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              {text("country", "Country")}
            </Section>

            {visible.length > 0 && (
              <Section icon={FileText} title="Business information & documents">
                {visible.map((f) =>
                  f.kind === "text" ? (
                    <div key={f.field}>{text(f.field, f.label, { placeholder: PLACEHOLDERS[f.field] }, f.mode === "required")}</div>
                  ) : (
                    <Field key={f.field} label={f.label} required={f.mode === "required"} error={errors[f.field]}>
                      <FilePicker id={f.field} file={files[f.field] ?? null} onChange={pickFile(f.field)} invalid={!!errors[f.field]} />
                    </Field>
                  ),
                )}
                <Field label="Other supporting documents" hint="Optional, up to 3 files" error={errors.otherDocs} className="sm:col-span-2">
                  <div className="space-y-2">
                    {others.map((f, i) => (
                      <FilePicker key={i} id={`other-${i}`} file={f} onChange={() => setOthers(others.filter((_, j) => j !== i))} />
                    ))}
                    {others.length < 3 && (
                      <FilePicker
                        id="other-new"
                        file={null}
                        onChange={(f) => {
                          if (!f) return;
                          if (f.size > MAX_FILE) return setErrors((e) => ({ ...e, otherDocs: "File is larger than 5 MB" }));
                          setOthers([...others, f]);
                        }}
                      />
                    )}
                  </div>
                </Field>
              </Section>
            )}

            <Section icon={KeyRound} title="Account password">
              {text("password", "Password", { type: "password", autoComplete: "new-password" })}
              {text("confirmPassword", "Confirm password", { type: "password", autoComplete: "new-password" })}
              <p className="text-xs text-slate-500 sm:col-span-2">At least 8 characters with at least one letter and one number.</p>
            </Section>

            <div className="space-y-4 border-t border-slate-100 pt-6">
              <Checkbox
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
                label={<>I confirm the information is correct and I accept the agent <span className="font-medium text-brand-700">terms and conditions</span> of {branding.name}.</>}
              />
              {errors.acceptTerms && <p className="text-xs text-accent-600">{errors.acceptTerms}</p>}
              {captchaKey && (
                <div className="space-y-1">
                  <Turnstile siteKey={captchaKey} onToken={setCaptchaToken} resetKey={captchaReset} />
                  {errors.captcha && <p className="text-xs text-accent-600">{errors.captcha}</p>}
                </div>
              )}
              <div className="flex flex-col-reverse items-center justify-between gap-4 sm:flex-row">
                <p className="text-sm text-slate-500">
                  Already registered?{" "}
                  <Link to="/login" className="font-semibold text-brand-700 hover:underline">
                    Log in
                  </Link>
                </p>
                <Button type="submit" size="lg" loading={submitting} icon={Send} className="w-full sm:w-auto" disabled={captchaKey === undefined || (!!captchaKey && !captchaToken)}>
                  Submit registration
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
