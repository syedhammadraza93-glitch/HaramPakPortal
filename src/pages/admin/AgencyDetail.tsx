import { ArrowLeft, Building2, FileText, History, Lock, Mail, MessageSquare, Pencil, Unlock, Users as UsersIcon, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Alert, Badge, Button, Card, CardHeader, Detail, EmptyState, Field, Input, Spinner, StatusBadge, Textarea } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useCan } from "../../redux/hooks";
import { api, errorMessage, fieldErrors, type AgencyStatus } from "../../utils/api";
import { ACTION_LABELS, AGENCY_STATUS, formatDate, formatDateTime, timeAgo } from "../../utils/format";
import { DocumentList } from "../agent/AgentProfile";
import { AgencyCommercialCard } from "./AgencyCommercialCard";
import { PROFILE_FIELDS, type AgencyDocument } from "../agent/types";

interface AgencyDetailData {
  id: string;
  agentCode: string | null;
  agencyName: string;
  authorizedPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  country: string;
  cnic: string | null;
  ntn: string | null;
  businessRegNo: string | null;
  licenceNo: string | null;
  status: AgencyStatus;
  termsAcceptedAt: string;
  termsVersion: string;
  createdAt: string;
  approvedAt: string | null;
  documents: AgencyDocument[];
  statusHistory: { id: string; fromStatus: AgencyStatus | null; toStatus: AgencyStatus; reason: string | null; changedByName: string | null; createdAt: string }[];
  notes: { id: string; note: string; createdByName: string; createdAt: string }[];
  users: { id: string; email: string; fullName: string; status: string; emailVerifiedAt: string | null; lastLoginAt: string | null; lockedUntil: string | null }[];
  allowedActions: string[];
  reasonRequired: Record<string, boolean>;
  canEdit: boolean;
  canAddNotes: boolean;
  canVerifyDocuments: boolean;
  pricingGroupId: string | null;
  agentCategory: string | null;
  version: number;
  portalAccess: { catalogue: boolean; bookings: boolean; finance: boolean };
}

const ACTION_HELP: Record<string, string> = {
  approve: "The agency becomes active, receives its Agent ID by email and can log in.",
  "request-info": "The agent is asked to update the application. Your message is emailed to them.",
  reject: "The application is closed. The reason is emailed to the agent.",
  suspend: "The agency is logged out everywhere and cannot log in until reactivated.",
  reactivate: "The agency can log in again.",
  deactivate: "The account is closed permanently. Only a Super Admin can reactivate it.",
  reopen: "The application goes back to the review queue.",
};

export function AgencyDetail() {
  const { id } = useParams();
  const toast = useToast();
  const canApprove = useCan("agent.approve");
  const canManageAccess = useCan("agent.access");
  const canSeeFinance = useCan("finance.view");
  const { data: a, loading, error, reload } = useApi<AgencyDetailData>(`/admin/agencies/${id}`);
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (loading && !a) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!a) return null;

  const run = async (fn: () => Promise<{ message?: string }>, after?: () => void) => {
    setBusy(true);
    try {
      const res = await fn();
      toast("success", res.message ?? "Done");
      after?.();
      await reload();
    } catch (err) {
      toast("error", errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!action) return;
    if (a.reasonRequired[action] && reason.trim().length < 3) return setReasonError("Please enter a reason (at least 3 characters)");
    await run(() => api.post(`/admin/agencies/${a.id}/status/${action}`, { reason }), () => setAction(null)).catch((err) => setReasonError(fieldErrors(err).reason));
  };

  const openAction = (key: string) => {
    setAction(key);
    setReason("");
    setReasonError(undefined);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    await run(() => api.patch(`/admin/agencies/${a.id}`, form), () => setEditing(false)).catch((err) => setErrors(fieldErrors(err)));
  };

  const startEdit = () => {
    setForm(Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, String(a[f.key as keyof AgencyDetailData] ?? "")])));
    setErrors({});
    setEditing(true);
  };

  return (
    <div className="space-y-6">
      <Link to="/admin/agencies" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Agencies
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{a.agencyName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge status={a.status} />
            {a.agentCode && <Badge tone="green">{a.agentCode}</Badge>}
            <span>Registered {formatDate(a.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSeeFinance && a.agentCode && <Link to={`/admin/finance/agencies/${a.id}`}><Button variant="secondary" icon={Wallet}>Ledger & credit</Button></Link>}
          {a.allowedActions.map((key) => (
            <Button key={key} variant={ACTION_LABELS[key]?.tone ?? "secondary"} onClick={() => openAction(key)}>
              {ACTION_LABELS[key]?.label ?? key}
            </Button>
          ))}
          {a.status === "pending_email_verification" && canApprove && (
            <Button variant="secondary" icon={Mail} loading={busy} onClick={() => run(() => api.post(`/admin/agencies/${a.id}/resend-verification`)).catch(() => undefined)}>
              Resend verification code
            </Button>
          )}
        </div>
      </div>

      {a.status === "pending_email_verification" && (
        <Alert tone="info">This agency has not entered its email verification code yet, so it cannot be reviewed.</Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader icon={Building2} title="Agency details" actions={a.canEdit && <Button size="sm" variant="secondary" icon={Pencil} onClick={startEdit}>Edit</Button>} />
            <dl className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {PROFILE_FIELDS.map((f) => (
                <Detail key={f.key} label={f.label}>{String(a[f.key as keyof AgencyDetailData] ?? "")}</Detail>
              ))}
              <Detail label="Email">{a.email}</Detail>
              <Detail label="Terms accepted">{`${formatDateTime(a.termsAcceptedAt)} (v${a.termsVersion})`}</Detail>
              {a.approvedAt && <Detail label="Approved on">{formatDateTime(a.approvedAt)}</Detail>}
            </dl>
          </Card>

          <Card>
            <CardHeader icon={FileText} title="Documents" description="Open each document and mark it verified once checked." />
            <DocumentList
              documents={a.documents}
              openPath={(docId) => `/admin/agencies/${a.id}/documents/${docId}`}
              actions={(d) =>
                a.canVerifyDocuments && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => api.patch(`/admin/agencies/${a.id}/documents/${d.id}`, { verified: !d.verified })).catch(() => undefined)}>
                    {d.verified ? "Unverify" : "Mark verified"}
                  </Button>
                )
              }
            />
          </Card>

          <Card>
            <CardHeader icon={UsersIcon} title="Login users" />
            <ul className="divide-y divide-slate-100">
              {a.users.map((u) => {
                const locked = !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">{u.fullName}</p>
                      <p className="text-xs text-slate-500">{u.email} · last login {timeAgo(u.lastLoginAt)}</p>
                    </div>
                    {u.emailVerifiedAt ? <Badge tone="green">Email verified</Badge> : <Badge>Email not verified</Badge>}
                    {locked && <Badge tone="red"><Lock className="size-3" /> Locked</Badge>}
                    {locked && a.canEdit && (
                      <Button size="sm" variant="ghost" icon={Unlock} onClick={() => run(() => api.post(`/admin/agencies/${a.id}/users/${u.id}/unlock`)).catch(() => undefined)}>
                        Unlock
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {canManageAccess && <Card>
            <CardHeader icon={Lock} title="Agency portal access" description="Controls all users in this agency." />
            <form key={a.version} className="space-y-3 p-5" onSubmit={event => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              void run(() => api.patch("/admin/agencies/" + a.id + "/access", {
                version: a.version, catalogue: values.has("catalogue"), bookings: values.has("bookings"), finance: values.has("finance"),
              })).catch(() => undefined);
            }}>
              {([["catalogue", "Catalogue and rates"], ["bookings", "Bookings and travel documents"], ["finance", "Ledger and payments"]] as const).map(([key, label]) =>
                <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={key} defaultChecked={a.portalAccess[key]} />{label}</label>)}
              <Button type="submit" loading={busy}>Save agency access</Button>
            </form>
          </Card>}
          <AgencyCommercialCard agencyId={a.id} pricingGroupId={a.pricingGroupId} agentCategory={a.agentCategory} onSaved={() => void reload()} />
          <Card>
            <CardHeader icon={History} title="Status history" />
            <ol className="space-y-4 p-5">
              {a.statusHistory.map((h) => (
                <li key={h.id} className="relative border-l-2 border-brand-200 pl-4">
                  <span className="absolute top-1 -left-[5px] size-2 rounded-full bg-brand-600" />
                  <p className="text-sm font-medium text-slate-800">{AGENCY_STATUS[h.toStatus].label}</p>
                  {h.reason && <p className="mt-0.5 text-sm text-slate-600">{h.reason}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(h.createdAt)}{h.changedByName ? ` · ${h.changedByName}` : ""}</p>
                </li>
              ))}
            </ol>
          </Card>

          {(a.canAddNotes || a.notes.length > 0) && (
            <Card>
              <CardHeader icon={MessageSquare} title="Internal notes" description="Never shown to the agent." />
              {a.canAddNotes && (
                <form
                  className="space-y-2 border-b border-slate-100 p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => api.post(`/admin/agencies/${a.id}/notes`, { note }), () => setNote("")).catch(() => undefined);
                  }}
                >
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called the owner, licence copy coming tomorrow" className="min-h-20" />
                  <Button size="sm" type="submit" disabled={note.trim().length < 2} loading={busy}>Add note</Button>
                </form>
              )}
              {a.notes.length === 0 ? (
                <EmptyState icon={MessageSquare} title="No notes yet" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {a.notes.map((n) => (
                    <li key={n.id} className="px-5 py-3">
                      <p className="text-sm whitespace-pre-wrap text-slate-700">{n.note}</p>
                      <p className="mt-1 text-xs text-slate-400">{n.createdByName} · {formatDateTime(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? `${ACTION_LABELS[action]?.label}: ${a.agencyName}` : ""}
        description={action ? ACTION_HELP[action] : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
            <Button type="submit" form="action-form" variant={action ? ACTION_LABELS[action]?.tone ?? "primary" : "primary"} loading={busy}>
              {action ? ACTION_LABELS[action]?.label : ""}
            </Button>
          </>
        }
      >
        <form id="action-form" onSubmit={confirmAction}>
          <Field
            label={action === "request-info" ? "What do you need from the agent?" : "Reason"}
            required={!!action && a.reasonRequired[action]}
            error={reasonError}
            hint={action && !a.reasonRequired[action] ? "Optional" : "Saved in the status history and emailed to the agent where relevant."}
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!reasonError} autoFocus />
          </Field>
        </form>
      </Modal>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit agency details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" form="edit-agency" loading={busy}>Save changes</Button>
          </>
        }
      >
        <form id="edit-agency" onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} error={errors[f.key]}>
              <Input value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} invalid={!!errors[f.key]} />
            </Field>
          ))}
        </form>
      </Modal>
    </div>
  );
}
