import { AlertTriangle, Building2, CheckCircle2, ExternalLink, FileText, Pencil, Send, Upload } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Alert, Badge, Button, Card, CardHeader, Detail, EmptyState, Field, Input, Select, Spinner, StatusBadge } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../utils/api";
import { DOC_TYPES, formatBytes, formatDate } from "../../utils/format";
import { PROFILE_FIELDS, type AgencyDocument, type AgencyProfile } from "./types";

export function DocumentList({ documents, openPath, actions }: { documents: AgencyDocument[]; openPath: (id: string) => string; actions?: (d: AgencyDocument) => ReactNode }) {
  const toast = useToast();
  if (documents.length === 0) return <EmptyState icon={FileText} title="No documents uploaded" />;
  return (
    <ul className="divide-y divide-slate-100">
      {documents.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
          <FileText className="size-5 shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{DOC_TYPES[d.docType] ?? d.docType}</p>
            <p className="truncate text-xs text-slate-500">
              {d.fileName} · {formatBytes(d.sizeBytes)} · {formatDate(d.createdAt)}
            </p>
          </div>
          {d.verified ? <Badge tone="green"><CheckCircle2 className="size-3" /> Verified</Badge> : <Badge>Not verified</Badge>}
          {actions?.(d)}
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => api.openFile(openPath(d.id)).catch((e) => toast("error", errorMessage(e)))}>
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function AgentProfile() {
  const toast = useToast();
  const { data: p, loading, error, reload } = useApi<AgencyProfile>("/agent/profile");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState("licence");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  if (loading && !p) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!p) return null;

  const startEdit = () => {
    setForm(Object.fromEntries(p.editableFields.map((f) => [f, String(p[f as keyof AgencyProfile] ?? "")])));
    setErrors({});
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await api.patch("/agent/profile", form);
      toast("success", res.message ?? "Saved");
      setEditing(false);
      await reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("docType", docType);
    fd.append("file", file);
    setUploading(true);
    try {
      const res = await api.postForm("/agent/documents", fd);
      toast("success", res.message ?? "Uploaded");
      setFile(null);
      (e.target as HTMLFormElement).reset();
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const resubmit = async () => {
    setResubmitting(true);
    try {
      const res = await api.post("/agent/profile/resubmit");
      toast("success", res.message ?? "Resubmitted");
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setResubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My agency</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            {p.agentCode && <Badge tone="green">Agent ID {p.agentCode}</Badge>}
          </div>
        </div>
        {p.canResubmit && (
          <Button icon={Send} loading={resubmitting} onClick={resubmit}>
            Resubmit application
          </Button>
        )}
      </div>

      {p.status === "information_required" && p.statusReason && (
        <Alert tone="warning" icon={AlertTriangle} title="Our team needs more information">
          <p>{p.statusReason}</p>
          <p className="mt-1">Update your details or upload the documents below, then click <b>Resubmit application</b>.</p>
        </Alert>
      )}

      <Card>
        <CardHeader
          icon={Building2}
          title="Agency details"
          description={p.editableFields.length === 0 ? "Details cannot be changed while your application is under review." : p.status === "active" ? "You can update your contact details." : undefined}
          actions={p.editableFields.length > 0 && <Button size="sm" variant="secondary" icon={Pencil} onClick={startEdit}>Edit</Button>}
        />
        <dl className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {PROFILE_FIELDS.map((f) => (
            <Detail key={f.key} label={f.label}>{String(p[f.key] ?? "")}</Detail>
          ))}
          <Detail label="Login email">{p.email}</Detail>
          <Detail label="Registered on">{formatDate(p.createdAt)}</Detail>
          {p.approvedAt && <Detail label="Approved on">{formatDate(p.approvedAt)}</Detail>}
        </dl>
      </Card>

      <Card>
        <CardHeader icon={FileText} title="Documents" description="Your documents are private and visible only to you and our staff." />
        <DocumentList documents={p.documents} openPath={(id) => `/agent/documents/${id}`} />
        {p.canUploadDocuments && (
          <form onSubmit={upload} className="flex flex-wrap items-end gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
            <Field label="Document type" className="w-full sm:w-56">
              <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
                {Object.entries(DOC_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="File (PDF, JPG or PNG, max 5 MB)" className="min-w-0 flex-1">
              <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-2 file:py-1 file:text-brand-700" />
            </Field>
            <Button type="submit" icon={Upload} loading={uploading} disabled={!file}>Upload</Button>
          </form>
        )}
      </Card>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit agency details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" form="profile-form" loading={saving}>Save changes</Button>
          </>
        }
      >
        <form id="profile-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.filter((f) => p.editableFields.includes(f.key)).map((f) => (
            <Field key={f.key} label={f.label} error={errors[f.key]}>
              <Input value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} invalid={!!errors[f.key]} />
            </Field>
          ))}
        </form>
      </Modal>
    </div>
  );
}
