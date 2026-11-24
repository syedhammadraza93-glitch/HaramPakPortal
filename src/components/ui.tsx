import { Loader2, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { AGENCY_STATUS } from "../utils/format";
import type { AgencyStatus } from "../utils/api";

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

// ---------- Buttons ----------

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-brand-500 shadow-sm",
  outline: "bg-transparent text-brand-700 border border-brand-600 hover:bg-brand-50 focus-visible:ring-brand-500",
  danger: "bg-accent-500 text-white hover:bg-accent-600 focus-visible:ring-accent-500 shadow-sm",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: LucideIcon;
}

export function Button({ variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, ...rest }: ButtonProps) {
  const sizes = { sm: "px-3 py-1.5 text-sm gap-1.5", md: "px-4 py-2 text-sm gap-2", lg: "px-5 py-2.5 text-base gap-2" };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

// ---------- Form fields ----------

interface FieldProps {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export function Field({ label, error, hint, required, children, className, htmlFor }: FieldProps) {
  return (
    <div className={cx("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-accent-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-accent-600">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const inputBase =
  "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500";
const inputTone = (invalid?: boolean) =>
  invalid ? "border-accent-500 focus:border-accent-500 focus:ring-accent-100" : "border-slate-300 focus:border-brand-500 focus:ring-brand-100";

export function Input({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...rest} aria-invalid={invalid || undefined} className={cx(inputBase, inputTone(invalid), className)} />;
}

export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select {...rest} aria-invalid={invalid || undefined} className={cx(inputBase, inputTone(invalid), "pr-8", className)}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...rest} aria-invalid={invalid || undefined} className={cx(inputBase, inputTone(invalid), "min-h-24", className)} />;
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-start gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" {...rest} className="mt-0.5 size-4 rounded border-slate-300 accent-brand-600" />
      <span>{label}</span>
    </label>
  );
}

// ---------- Layout pieces ----------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, icon: Icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="rounded-lg bg-brand-50 p-2 text-brand-700">
            <Icon className="size-4" />
          </div>
        )}
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Feedback ----------

const TONES = {
  green: "bg-brand-50 text-brand-700 ring-brand-600/20",
  amber: "bg-gold-100 text-amber-800 ring-amber-600/20",
  red: "bg-accent-50 text-accent-700 ring-accent-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: AgencyStatus }) {
  const s = AGENCY_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ALERTS = {
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-brand-200 bg-brand-50 text-brand-800",
  warning: "border-amber-200 bg-gold-100 text-amber-900",
  error: "border-accent-100 bg-accent-50 text-accent-700",
};

export function Alert({ tone = "info", title, children, icon: Icon, className }: { tone?: keyof typeof ALERTS; title?: ReactNode; children?: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex gap-3 rounded-lg border px-4 py-3 text-sm", ALERTS[tone], className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cx("flex items-center justify-center gap-2 py-10 text-sm text-slate-500", className)}>
      <Loader2 className="size-5 animate-spin text-brand-600" /> {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">
        <Icon className="size-6" />
      </div>
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Label / value pair for detail grids. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm break-words text-slate-800">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}
