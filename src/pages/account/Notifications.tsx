import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PortalNotification } from "../../components/NotificationBell";
import { Button, Card, EmptyState, PageHeader, Pagination, Select, Spinner, cx } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api } from "../../utils/api";
import { formatDateTime } from "../../utils/format";

export function Notifications() {
  const navigate = useNavigate();
  const [q, setQ] = useState({ unread: "", page: 1 });
  const { data, loading, reload } = useApi<{ items: PortalNotification[]; total: number; unread: number; page: number; pageSize: number }>("/notifications", { unread: q.unread || undefined, page: q.page, pageSize: 25 });

  const open = async (n: PortalNotification) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    if (n.link) navigate(n.link);
    else void reload();
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={data ? `${data.unread} unread` : undefined}
        actions={data && data.unread > 0 && <Button variant="secondary" icon={CheckCheck} onClick={async () => { await api.post("/notifications/read-all"); void reload(); }}>Mark all read</Button>}
      />
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <Select value={q.unread} onChange={(e) => setQ({ unread: e.target.value, page: 1 })} className="w-auto">
            <option value="">All</option>
            <option value="true">Unread only</option>
          </Select>
        </div>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState icon={Bell} title="No notifications" /> : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => open(n)} className={cx("flex w-full gap-3 px-5 py-4 text-left hover:bg-slate-50", !n.readAt && "bg-brand-50/50")}>
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-slate-200" : "bg-brand-600")} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-800">{n.title}</span>
                      {n.body && <span className="mt-0.5 block whitespace-pre-line text-sm text-slate-600">{n.body}</span>}
                      <span className="mt-1 block text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setQ({ ...q, page })} />
          </>
        )}
      </Card>
    </div>
  );
}
