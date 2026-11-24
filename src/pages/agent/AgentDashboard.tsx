import { AlertTriangle, BadgeCheck, CalendarClock, Check, Clock, Globe2, Hourglass, Landmark, Megaphone, MoonStar, Plane, Receipt, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, Card, CardHeader, Spinner, cx } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useMe } from "../../redux/hooks";
import { VERTICALS, formatDate, formatMoney, type Vertical } from "../../utils/format";
import { CreditStats } from "../finance/shared";
import type { CreditInfo } from "../finance/types";
import type { AgencyProfile } from "./types";

const PRODUCTS = [
  { icon: MoonStar, vertical: "umrah", title: VERTICALS.umrah, text: "Umrah packages and visa services" },
  { icon: Landmark, vertical: "hajj", title: VERTICALS.hajj, text: "Hajj packages by season" },
  { icon: Globe2, vertical: "tourism", title: VERTICALS.tourism, text: "Tour packages to international destinations" },
] as const;

function Steps({ status }: { status: AgencyProfile["status"] }) {
  const reviewDone = status === "active";
  const steps = [
    { label: "Registered", done: true },
    { label: "Email verified", done: true },
    { label: status === "information_required" ? "More information needed" : "Under review", done: reviewDone, current: !reviewDone },
    { label: "Approved · Agent ID issued", done: reviewDone },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-3 sm:flex-col sm:items-start">
          <span
            className={cx(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              s.done ? "bg-brand-600 text-white" : s.current ? "bg-gold-400 text-brand-900" : "bg-slate-200 text-slate-500",
            )}
          >
            {s.done ? <Check className="size-4" /> : i + 1}
          </span>
          <span className={cx("text-sm", s.current ? "font-semibold text-slate-900" : "text-slate-600")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  startsAt: string;
}

interface AgentDash {
  active: boolean;
  announcements: Announcement[];
  credit?: CreditInfo;
  bookingGroups?: { inProgress: number; confirmed: number; completed: number; cancelled: number };
  awaitingPayment?: number;
  recentEntries?: { id: string; entryNumber: string; entryDate: string; typeLabel: string; description: string; debit: number; credit: number }[];
  upcomingTrips?: { id: string; reference: string; packageName: string; departureDate: string; paxCount: number; status: string }[];
}

function Announcements({ items }: { items: Announcement[] }) {
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader icon={Megaphone} title="Announcements" />
      <ul className="divide-y divide-slate-100">
        {items.map((a) => (
          <li key={a.id} className="px-5 py-4">
            <p className="font-semibold text-slate-900">{a.title}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{a.body}</p>
            <p className="mt-1 text-xs text-slate-400">{formatDate(a.startsAt)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountOverview({ d }: { d: AgentDash }) {
  if (!d.credit || !d.bookingGroups) return null;
  const g = d.bookingGroups;
  const cur = d.credit.currency;
  return (
    <div className="space-y-6">
      <CreditStats credit={d.credit} forAgent />
      {(d.awaitingPayment ?? 0) > 0 && (
        <Alert tone="warning" icon={Wallet} title={`${d.awaitingPayment} booking${d.awaitingPayment === 1 ? " is" : "s are"} waiting for payment`}>
          Seats are held until the hold ends. <Link to="/agent/ledger" className="font-semibold underline">Pay now</Link>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "In progress", value: g.inProgress, to: "/agent/bookings" },
          { label: "Confirmed", value: g.confirmed, to: "/agent/bookings" },
          { label: "Completed", value: g.completed, to: "/agent/bookings" },
          { label: "Cancelled", value: g.cancelled, to: "/agent/bookings" },
        ].map((t) => (
          <Link key={t.label} to={t.to} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.label} bookings</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{t.value}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 2xl:grid-cols-2">
        <Card>
          <CardHeader icon={Receipt} title="Recent account entries" actions={<Link to="/agent/ledger" className="text-sm font-medium text-brand-700 hover:underline">Statement</Link>} />
          {!d.recentEntries?.length ? <p className="p-5 text-sm text-slate-500">No entries yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {d.recentEntries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-slate-800">{e.description}</p>
                    <p className="text-xs text-slate-500">{formatDate(e.entryDate)} · {e.typeLabel}</p>
                  </div>
                  <span className={cx("font-medium whitespace-nowrap", e.debit ? "text-slate-900" : "text-brand-700")}>{e.debit ? formatMoney(e.debit, cur) : `− ${formatMoney(e.credit, cur)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={CalendarClock} title="Upcoming trips" />
          {!d.upcomingTrips?.length ? <p className="p-5 text-sm text-slate-500">No confirmed trips coming up.</p> : (
            <ul className="divide-y divide-slate-100">
              {d.upcomingTrips.map((t) => (
                <li key={t.id}>
                  <Link to={`/agent/bookings/${t.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">{t.packageName}</p>
                      <p className="text-xs text-slate-500"><span className="font-mono">{t.reference}</span> · {t.paxCount} passenger{t.paxCount === 1 ? "" : "s"}</p>
                    </div>
                    <span className="whitespace-nowrap text-slate-700">{formatDate(t.departureDate)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function AgentDashboard() {
  const me = useMe();
  const { data: profile, loading, error } = useApi<AgencyProfile>("/agent/profile");
  // Packages are only for approved agencies.
  const summary = useApi<{ counts: Record<Vertical, number> }>(me?.agency?.status === "active" && me.agency.access.catalogue ? "/agent/catalogue/summary" : null);
  const dash = useApi<AgentDash>("/agent/dashboard");

  if (loading && !profile) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!profile) return null;
  const active = profile.status === "active";

  return (
    <div className="space-y-6">
      <div className="brand-pattern overflow-hidden rounded-2xl p-6 text-white sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-gold-400">Assalam-o-Alaikum</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{me?.fullName}</h1>
        <p className="mt-1 text-brand-100">{profile.agencyName}</p>
        {active && (
          <div className="mt-5 inline-flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/20">
            <BadgeCheck className="size-6 text-gold-400" />
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100">Your Agent ID</p>
              <p className="text-xl font-bold tracking-wider">{profile.agentCode}</p>
            </div>
          </div>
        )}
      </div>

      {!active && (
        <Card>
          <CardHeader icon={Hourglass} title="Your application" description={`Submitted on ${formatDate(profile.createdAt)}`} />
          <div className="space-y-5 p-5">
            <Steps status={profile.status} />
            {profile.status === "information_required" ? (
              <Alert tone="warning" icon={AlertTriangle} title="Our team needs more information">
                <p>{profile.statusReason}</p>
                <Link to="/agent/profile" className="mt-2 inline-block font-semibold text-brand-800 underline">
                  Update your application and resubmit →
                </Link>
              </Alert>
            ) : (
              <Alert tone="info" icon={Clock}>
                Your application is being reviewed. We will email you as soon as it is approved. You can check your details and upload more
                documents under <Link to="/agent/profile" className="font-semibold underline">My agency</Link>.
              </Alert>
            )}
          </div>
        </Card>
      )}

      {dash.data && <Announcements items={dash.data.announcements} />}
      {active && dash.data?.active && <AccountOverview d={dash.data} />}

      {me?.agency?.access.catalogue && <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Products</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PRODUCTS.map(({ icon: Icon, vertical, title, text }) => {
            const count = summary.data?.counts[vertical];
            const body = (
              <Card className={cx("relative h-full overflow-hidden p-5", active && "transition hover:shadow-md")}>
                {active ? (
                  <span className="absolute top-3 right-3 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {count === undefined ? "…" : `${count} package${count === 1 ? "" : "s"}`}
                  </span>
                ) : (
                  <span className="absolute top-3 right-3 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">After approval</span>
                )}
                <div className="mb-3 inline-flex rounded-lg bg-brand-50 p-2.5 text-brand-700">
                  <Icon className="size-5" />
                </div>
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="mt-1 text-sm text-slate-500">{text}</p>
              </Card>
            );
            return active ? <Link key={vertical} to={`/agent/packages?vertical=${vertical}`}>{body}</Link> : <div key={vertical}>{body}</div>;
          })}
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Plane className="size-4 text-brand-600" />
          {active ? (
            <>Prices shown are your agency's prices.</>
          ) : (
            <>Packages and prices become visible once your agency is approved.</>
          )}
        </p>
      </div>}
    </div>
  );
}
