import { Building, ListChecks } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useToast } from "../../components/Toast";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../utils/api";
import { BrandingSettings } from "./BrandingSettings";
import { BookingSettingsCard } from "./BookingSettingsCard";
import { DocumentTemplatesCard, NotificationSettingsCard } from "./CommunicationSettings";
import { SecuritySettingsCard } from "./SecuritySettings";
import { useReloadBranding } from "../../branding/BrandingProvider";

interface Company {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  termsVersion: string;
  timezone: string;
  currency: string;
}

interface RegField {
  field: string;
  label: string;
  kind: "text" | "file";
  mode: "required" | "optional" | "hidden";
}

export function SettingsPage() {
  const toast = useToast();
  const reloadBranding = useReloadBranding();
  const company = useApi<Company>("/admin/settings/company");
  const fields = useApi<RegField[]>("/admin/settings/registration-fields");
  const [form, setForm] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingFields, setSavingFields] = useState(false);

  useEffect(() => {
    if (company.data) {
      const c = company.data;
      setForm({ name: c.name, address: c.address ?? "", phone: c.phone ?? "", email: c.email ?? "", website: c.website ?? "", termsVersion: c.termsVersion });
    }
  }, [company.data]);

  useEffect(() => {
    if (fields.data) setModes(Object.fromEntries(fields.data.map((f) => [f.field, f.mode])));
  }, [fields.data]);

  const saveCompany = async (e: FormEvent) => {
    e.preventDefault();
    setSavingCompany(true);
    setErrors({});
    try {
      const res = await api.put("/admin/settings/company", form);
      toast("success", res.message ?? "Saved");
      await reloadBranding();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSavingCompany(false);
    }
  };

  const saveFields = async () => {
    setSavingFields(true);
    try {
      const res = await api.put("/admin/settings/registration-fields", { fields: Object.entries(modes).map(([field, mode]) => ({ field, mode })) });
      toast("success", res.message ?? "Saved");
      await fields.reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSavingFields(false);
    }
  };

  const input = (key: string, label: string, required = false) => (
    <Field label={label} required={required} error={errors[key]}>
      <Input value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} invalid={!!errors[key]} />
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Company details, branding, security, notifications, documents and the agent sign-up form." />
      <BrandingSettings />
      <BookingSettingsCard />
      <SecuritySettingsCard />
      <div className="grid gap-6 xl:grid-cols-2">
        <NotificationSettingsCard />
        <DocumentTemplatesCard />
      </div>
      {(company.error || fields.error) && <Alert tone="error">{company.error || fields.error}</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Building} title="Company details" />
          {!company.data ? (
            <Spinner />
          ) : (
            <form onSubmit={saveCompany} className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">{input("name", "Company name", true)}</div>
              <div className="sm:col-span-2">{input("address", "Address")}</div>
              {input("phone", "Phone")}
              {input("email", "Email")}
              {input("website", "Website")}
              {input("termsVersion", "Agent terms version", true)}
              <p className="text-xs text-slate-500 sm:col-span-2">
                Time zone {company.data.timezone} · currency {company.data.currency}. Changing the terms version records the new version for future sign-ups.
              </p>
              <div className="sm:col-span-2">
                <Button type="submit" loading={savingCompany}>Save company details</Button>
              </div>
            </form>
          )}
        </Card>

        <Card>
          <CardHeader icon={ListChecks} title="Agent sign-up fields" description="Choose which business details and documents new agents must provide." />
          {!fields.data ? (
            <Spinner />
          ) : (
            <div className="p-5">
              <ul className="divide-y divide-slate-100">
                {fields.data.map((f) => (
                  <li key={f.field} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{f.label}</p>
                      <p className="text-xs text-slate-500">{f.kind === "file" ? "Document upload" : "Text field"}</p>
                    </div>
                    <Select value={modes[f.field] ?? f.mode} onChange={(e) => setModes({ ...modes, [f.field]: e.target.value })} className="w-36">
                      <option value="required">Required</option>
                      <option value="optional">Optional</option>
                      <option value="hidden">Hidden</option>
                    </Select>
                  </li>
                ))}
              </ul>
              <Button className="mt-4" loading={savingFields} onClick={saveFields}>Save sign-up fields</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
