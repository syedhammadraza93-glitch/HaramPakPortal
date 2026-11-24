import { ImagePlus, Palette, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useBranding, useReloadBranding } from "../../branding/BrandingProvider";
import { Logo } from "../../components/Logo";
import { useToast } from "../../components/Toast";
import { Button, Card, CardHeader, Field, Input, Textarea } from "../../components/ui";
import { api, errorMessage, fieldErrors } from "../../utils/api";

const toLines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} error={error}>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label={label} />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono uppercase" maxLength={7} invalid={!!error} />
      </div>
    </Field>
  );
}

/** Settings → Branding: everything the portal shows about the company. */
export function BrandingSettings() {
  const branding = useBranding();
  const reloadBranding = useReloadBranding();
  const toast = useToast();
  const [form, setForm] = useState({
    portalName: "", tagline: "", heroTitle: "", aboutText: "", highlights: "", footerText: "",
    primaryColor: "", accentColor: "", highlightColor: "", cities: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setForm({
      portalName: branding.portalName,
      tagline: branding.tagline ?? "",
      heroTitle: branding.heroTitle ?? "",
      aboutText: branding.aboutText ?? "",
      highlights: branding.highlights.join("\n"),
      footerText: branding.footerText ?? "",
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      highlightColor: branding.highlightColor,
      cities: branding.cities.join("\n"),
    });
  }, [branding]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await api.put("/admin/settings/branding", { ...form, highlights: toLines(form.highlights), cities: toLines(form.cities) });
      toast("success", res.message ?? "Branding saved");
      await reloadBranding();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const res = await api.postForm("/admin/settings/logo", fd);
      toast("success", res.message ?? "Logo updated");
      await reloadBranding();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    try {
      const res = await api.del("/admin/settings/logo");
      toast("success", res.message ?? "Logo removed");
      await reloadBranding();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader icon={Palette} title="Branding" description="Name, logo, colours and texts shown on the portal and in emails. Changes apply immediately for everyone." />
      <div className="grid gap-6 p-5 xl:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">Logo</p>
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Logo size={72} className="ring-slate-200" />
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                <ImagePlus className="size-4" /> {uploading ? "Uploading…" : branding.logoUrl ? "Change" : "Upload"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => void uploadLogo(e.target.files?.[0])} />
              </label>
              {branding.logoUrl && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={removeLogo}>Remove</Button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">PNG, JPG or WebP, max 5 MB. A square image works best. Without a logo, the company initials are shown.</p>
        </div>

        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Portal name" required error={errors.portalName} hint="Shown under the company name, e.g. Agent Portal">
            <Input value={form.portalName} onChange={set("portalName")} invalid={!!errors.portalName} />
          </Field>
          <Field label="Tagline" error={errors.tagline}>
            <Input value={form.tagline} onChange={set("tagline")} invalid={!!errors.tagline} />
          </Field>
          <Field label="Login page heading" error={errors.heroTitle} className="sm:col-span-2">
            <Input value={form.heroTitle} onChange={set("heroTitle")} invalid={!!errors.heroTitle} />
          </Field>
          <Field label="Login page text" error={errors.aboutText} className="sm:col-span-2">
            <Textarea value={form.aboutText} onChange={set("aboutText")} className="min-h-20" invalid={!!errors.aboutText} />
          </Field>
          <Field label="Login page highlights" hint="One per line, up to 6" error={errors.highlights}>
            <Textarea value={form.highlights} onChange={set("highlights")} className="min-h-28" />
          </Field>
          <Field label="Cities on the sign-up form" hint="One per line (suggestions; agents can still type another city)" error={errors.cities}>
            <Textarea value={form.cities} onChange={set("cities")} className="min-h-28" />
          </Field>
          <Field label="Sidebar footer text" error={errors.footerText} className="sm:col-span-2">
            <Input value={form.footerText} onChange={set("footerText")} invalid={!!errors.footerText} />
          </Field>
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
            <ColorField label="Main colour" value={form.primaryColor} onChange={(v) => setForm((f) => ({ ...f, primaryColor: v }))} error={errors.primaryColor} />
            <ColorField label="Accent colour" value={form.accentColor} onChange={(v) => setForm((f) => ({ ...f, accentColor: v }))} error={errors.accentColor} />
            <ColorField label="Highlight colour" value={form.highlightColor} onChange={(v) => setForm((f) => ({ ...f, highlightColor: v }))} error={errors.highlightColor} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={saving}>Save branding</Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
