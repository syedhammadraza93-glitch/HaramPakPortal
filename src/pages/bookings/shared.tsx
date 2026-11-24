import { Clock, History, MessageSquare, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Textarea, cx } from "../../components/ui";
import { BOOKING_STATUS, formatDateTime, formatMoney } from "../../utils/format";
import type { BookingDetail, PriceLine } from "./types";

export function BookingStatusBadge({ status }: { status: string }) {
  const s = BOOKING_STATUS[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Hours / minutes until a seat hold runs out. */
export function holdLeft(holdExpiresAt: string | null): string | null {
  if (!holdExpiresAt) return null;
  const ms = new Date(holdExpiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function PriceTable({ lines, currency, total, title = "Price" }: { lines: PriceLine[]; currency: string; total: number; title?: string }) {
  if (!lines.length) return <EmptyState icon={Clock} title="No price yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr><th className="py-2 pr-3">{title}</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Each</th><th className="py-2 text-right">Amount</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2 pr-3 text-slate-700">{l.description}</td>
              <td className="py-2 pr-3 text-right text-slate-600">{l.quantity}</td>
              <td className="py-2 pr-3 text-right text-slate-600">{formatMoney(l.unitAmount, currency)}</td>
              <td className="py-2 text-right font-medium text-slate-800">{formatMoney(l.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200">
            <td colSpan={3} className="py-2.5 pr-3 font-semibold text-slate-900">Total</td>
            <td className="py-2.5 text-right text-lg font-bold text-brand-700">{formatMoney(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function HistoryCard({ history }: { history: BookingDetail["history"] }) {
  return (
    <Card>
      <CardHeader icon={History} title="Status history" />
      {history.length === 0 ? <p className="p-5 text-sm text-slate-500">Not submitted yet.</p> : (
        <ol className="space-y-4 p-5">
          {history.map((h) => (
            <li key={h.id} className="relative border-l-2 border-brand-200 pl-4">
              <span className="absolute top-1 -left-[5px] size-2 rounded-full bg-brand-600" />
              <p className="text-sm font-medium text-slate-800">{BOOKING_STATUS[h.toStatus]?.label ?? h.toStatus}</p>
              {h.reason && <p className="mt-0.5 text-sm whitespace-pre-line text-slate-600">{h.reason}</p>}
              <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(h.createdAt)}{h.changedByName ? ` · ${h.changedByName}` : ""}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Conversation between the agent and Operations. Staff can also add internal notes. */
export function MessagesCard({ messages, canSend, staff, onSend }: { messages: BookingDetail["messages"]; canSend: boolean; staff: boolean; onSend: (message: string, isInternal: boolean) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    if (await onSend(text, internal)) setText("");
    setSending(false);
  };
  return (
    <Card>
      <CardHeader icon={MessageSquare} title="Messages" description={staff ? "Messages go to the agent by email. Internal notes stay with your team." : "Talk to our operations team about this booking."} />
      <div className="space-y-3 p-5">
        {messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
        {messages.map((m) => {
          const mine = staff ? m.authorType === "staff" : m.authorType === "agent";
          return (
            <div key={m.id} className={cx("max-w-[85%] rounded-xl px-4 py-2.5 text-sm", mine ? "ml-auto bg-brand-50 text-brand-900" : "bg-slate-100 text-slate-800", m.isInternal && "border border-dashed border-amber-400 bg-gold-100")}>
              <p className="whitespace-pre-line">{m.message}</p>
              <p className="mt-1 text-[11px] text-slate-500">{m.isInternal ? "Internal note · " : ""}{m.authorName} · {formatDateTime(m.createdAt)}</p>
            </div>
          );
        })}
      </div>
      {canSend && (
        <form onSubmit={submit} className="space-y-2 border-t border-slate-100 p-4">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={staff ? "Write to the agent…" : "Write to our team…"} className="min-h-20" />
          <div className="flex items-center justify-between gap-2">
            {staff ? <Checkbox label="Internal note (not sent to the agent)" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> : <span />}
            <Button type="submit" size="sm" icon={Send} loading={sending} disabled={!text.trim()}>{internal ? "Add note" : "Send"}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
