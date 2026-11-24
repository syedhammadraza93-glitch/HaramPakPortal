import { BadgeCheck, Building2, CheckCircle2, MapPin, Plane, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useBranding } from "../branding/BrandingProvider";
import { Logo } from "../components/Logo";
import { cx } from "../components/ui";

const HIGHLIGHT_ICONS = [Building2, Plane, ShieldCheck, BadgeCheck, CheckCircle2];

/** Split screen: brand panel (texts from Settings → Branding) + form. */
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const b = useBranding();

  return (
    <div className="flex min-h-full">
      <aside className="brand-pattern relative hidden w-[42%] max-w-2xl flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <Link to="/login" className="flex items-center gap-3">
          <Logo size={56} />
          <div className="min-w-0">
            <p className="text-xl font-bold">{b.name}</p>
            {b.tagline && <p className="text-xs font-semibold uppercase tracking-widest text-gold-400">{b.tagline}</p>}
          </div>
        </Link>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-gold-400">{b.portalName}</p>
            <h1 className="mt-3 text-4xl leading-tight font-extrabold">{b.heroTitle || b.name}</h1>
            <span className="mt-4 block h-1 w-16 rounded-full bg-accent-500" />
            {b.aboutText && <p className="mt-4 max-w-md text-brand-100">{b.aboutText}</p>}
          </div>
          {b.highlights.length > 0 && (
            <ul className="space-y-3">
              {b.highlights.map((text, i) => {
                const Icon = HIGHLIGHT_ICONS[i % HIGHLIGHT_ICONS.length]!;
                return (
                  <li key={text} className="flex items-start gap-3 text-sm text-brand-50">
                    <span className="rounded-lg bg-white/10 p-1.5">
                      <Icon className="size-4 text-gold-400" />
                    </span>
                    {text}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-1 text-xs text-brand-200">
          {b.address && (
            <p className="flex items-center gap-2">
              <MapPin className="size-4 text-gold-400" /> {b.address}
            </p>
          )}
          {(b.phone || b.email) && <p className="pl-6">{[b.phone, b.email].filter(Boolean).join(" · ")}</p>}
        </div>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <Link to="/login" className="mb-8 flex items-center gap-3 lg:hidden">
          <Logo size={48} className="ring-brand-100" />
          <div>
            <p className="text-lg font-bold text-brand-700">{b.name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent-500">{b.portalName}</p>
          </div>
        </Link>
        <div className={cx("w-full", wide ? "max-w-4xl" : "max-w-md")}>{children}</div>
      </main>
    </div>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
