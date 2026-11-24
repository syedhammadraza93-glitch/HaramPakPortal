import { useBranding } from "../branding/BrandingProvider";
import { cx } from "./ui";

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "•";

/** Company logo from Settings (white circle), or the company initials when no logo is uploaded. */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  const { logoUrl, name } = useBranding();
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-white/70", className)}
      style={{ width: size, height: size }}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={name} className="size-full object-contain" />
      ) : (
        <span className="font-bold text-brand-700" style={{ fontSize: size * 0.38 }}>{initials(name)}</span>
      )}
    </span>
  );
}

export function BrandName({ light = false }: { light?: boolean }) {
  const { name, portalName } = useBranding();
  return (
    <div className="min-w-0 leading-tight">
      <p className={cx("truncate font-bold", light ? "text-white" : "text-brand-700")}>{name}</p>
      <p className={cx("truncate text-[11px] font-semibold uppercase tracking-wider", light ? "text-gold-400" : "text-accent-500")}>{portalName}</p>
    </div>
  );
}
