import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../utils/api";
import { timeAgo } from "../utils/format";
import { cx } from "./ui";

export interface PortalNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Header bell: unread count (checked every minute and when the tab gets focus) and the latest notifications. */
export function NotificationBell({ allPath }: { allPath: string }) {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PortalNotification[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    api.get<{ unread: number }>("/notifications/unread-count").then((d) => setUnread(d.unread)).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, 60_000);
    window.addEventListener("focus", refreshCount);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshCount);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    api.get<{ items: PortalNotification[]; unread: number }>("/notifications", { pageSize: 8 }).then((d) => {
      setItems(d.items);
      setUnread(d.unread);
    }).catch(() => setItems([]));
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openItem = async (n: PortalNotification) => {
    setOpen(false);
    if (!n.readAt) {
      await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
      refreshCount();
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    await api.post("/notifications/read-all").catch(() => undefined);
    setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    setUnread(0);
  };

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-accent-600 px-1 text-center text-[11px] font-semibold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">Notifications</span>
            {unread > 0 && <button onClick={readAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><CheckCheck className="size-3.5" /> Mark all read</button>}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items === null && <li className="px-4 py-6 text-center text-sm text-slate-500">Loading…</li>}
            {items?.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <button onClick={() => openItem(n)} className={cx("flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50", !n.readAt && "bg-brand-50/50")}>
                  <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link to={allPath} onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-slate-50">See all</Link>
        </div>
      )}
    </div>
  );
}
