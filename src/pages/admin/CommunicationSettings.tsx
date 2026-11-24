import { BellRing, FileText, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Button, Card, CardHeader, Checkbox, Field, Input, Spinner, Textarea } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../utils/api";

/** Settings → Notifications: which agent alerts are also emailed, and balance reminders. */
export function NotificationSettingsCard() {
  const toast = useToast();
  const { data } = useApi<{ emailNewPackages: boolean; emailPriceChanges: boolean; balanceReminderDays: number }>("/admin/settings/notifications");
  const [f, setF] = useState({ emailNewPackages: true, emailPriceChanges: false, balanceReminderDays: "7" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setF({ emailNewPackages: data.emailNewPackages, emailPriceChanges: data.emailPriceChanges, balanceReminderDays: String(data.balanceReminderDays) });
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put("/admin/settings/notifications", { ...f, balanceReminderDays: Number(f.balanceReminderDays) || 0 });
      toast("success", res.message ?? "Saved");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={BellRing} title="Notifications" description="Agents always see alerts in the portal. Booking and payment updates are always emailed too." />
      {!data ? <Spinner /> : (
        <div className="space-y-4 p-5">
          <Checkbox label="Email agencies when a new package is published" checked={f.emailNewPackages} onChange={(e) => setF({ ...f, emailNewPackages: e.target.checked })} />
          <Checkbox label="Email agencies when the prices of a published package change" checked={f.emailPriceChanges} onChange={(e) => setF({ ...f, emailPriceChanges: e.target.checked })} />
          <Field label="Balance reminder every (days)" hint="Agencies that owe money get a reminder by email and in the portal. 0 = never.">
            <Input type="number" min={0} max={90} value={f.balanceReminderDays} onChange={(e) => setF({ ...f, balanceReminderDays: e.target.value })} className="max-w-32" />
          </Field>
          <Button loading={saving} onClick={save}>Save notification settings</Button>
        </div>
      )}
    </Card>
  );
}

interface Template {
  type: string;
  label: string;
  title: string;
  introText: string | null;
  footerText: string | null;
}

/** Settings → Documents: the text around each generated PDF. Branding comes from the company settings. */
export function DocumentTemplatesCard() {
  const toast = useToast();
  const { data, reload } = useApi<Template[]>("/admin/settings/documents");
  const [editing, setEditing] = useState<Template | null>(null);
  const [f, setF] = useState({ title: "", introText: "", footerText: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const open = (t: Template) => {
    setErrors({});
    setF({ title: t.title, introText: t.introText ?? "", footerText: t.footerText ?? "" });
    setEditing(t);
  };
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await api.put(`/admin/settings/documents/${editing.type}`, f);
      toast("success", res.message ?? "Saved");
      setEditing(null);
      void reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={FileText} title="Documents" description="Title, opening text and terms printed on each PDF. Logo, company name, address and colours come from the settings above." />
      {!data ? <Spinner /> : (
        <ul className="divide-y divide-slate-100">
          {data.map((t) => (
            <li key={t.type} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{t.label}</p>
                <p className="truncate text-xs text-slate-500">Title “{t.title}”{t.footerText ? ` · terms: ${t.footerText.split("\n")[0]}` : " · no terms yet"}</p>
              </div>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(t)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing ? `${editing.label}` : ""}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Title on the document" required error={errors.title}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} invalid={!!errors.title} /></Field>
          <Field label="Opening text" hint="Printed under the title, e.g. a thank-you line."><Textarea value={f.introText} onChange={(e) => setF({ ...f, introText: e.target.value })} className="min-h-20" /></Field>
          <Field label="Terms and notes" hint="Printed at the end: terms and conditions, payment terms, contact for queries."><Textarea value={f.footerText} onChange={(e) => setF({ ...f, footerText: e.target.value })} className="min-h-32" /></Field>
        </div>
      </Modal>
    </Card>
  );
}
