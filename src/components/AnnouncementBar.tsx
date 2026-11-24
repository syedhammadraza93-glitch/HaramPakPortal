import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { useApi } from "../hooks/useApi";

type Announcement = { id: string; title: string; body: string };

export function AnnouncementBar() {
  const { data, error, reload } = useApi<Announcement[]>("/agent/announcements");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(interval);
  }, [reload]);

  if (error || !data?.length) return null;

  const titles = data.map(item => item.title).join("  •  ");
  return (
    <section aria-label="Agent announcements" className="relative flex min-w-0 items-center gap-2 bg-brand-800 px-4 py-2 text-sm text-white sm:px-6">
      <Megaphone aria-hidden="true" className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 overflow-hidden" aria-hidden="true">
        <div className="agent-announcements-track w-max whitespace-nowrap" data-paused={paused}>
          <span className="inline-block pr-12">{titles}</span>
          <span className="agent-announcements-copy inline-block pr-12">{titles}</span>
        </div>
      </div>
      <button type="button" className="agent-announcements-motion shrink-0 rounded border border-white/50 px-2 py-1" onClick={() => setPaused(value => !value)}>
        {paused ? "Resume" : "Pause"}<span className="sr-only"> announcement scrolling</span>
      </button>
      <details className="shrink-0">
        <summary className="cursor-pointer rounded border border-white/50 px-2 py-1">Read notices</summary>
        <ul className="absolute inset-x-0 top-full max-h-72 space-y-3 overflow-auto border-b bg-white p-4 text-slate-900 shadow-lg sm:left-auto sm:w-full sm:max-w-md">
          {data.map(item => <li key={item.id}>
            <p className="break-words font-semibold">{item.title}</p>
            <p className="whitespace-pre-wrap break-words text-slate-700">{item.body}</p>
          </li>)}
        </ul>
      </details>
    </section>
  );
}
