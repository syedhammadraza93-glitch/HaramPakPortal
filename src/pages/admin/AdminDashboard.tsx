import { ArrowRight, BookOpen, Building2, CalendarClock, CheckCircle2, FileSearch, Hourglass, Receipt, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, Card, CardHeader, EmptyState, Spinner, StatusBadge, cx } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useCan, useMe } from "../../redux/hooks";
import type { AgencyStatus } from "../../utils/api";
import { AGENCY_STATUS, VERTICALS, formatDate, formatMoney, timeAgo, type Vertical } from "../../utils/format";
import { SalesChart, type MonthSales } from "./SalesChart";

interface Dashboard {
  currency: string;
  today: string;
  agencies?: { counts: Partial<Record<AgencyStatus, number>>; waitingForReview: { id: string; agencyName: string; city: string; status: AgencyStatus; createdAt: string }[]; registrationsLast7Days: number };
  bookings?: { counts: Record<string, number>; queue: number; active: number; documentsToCheck: number; confirmedThisMonth: number };
  sales?: { months: MonthSales[]; thisMonth: { umrah: number; hajj: number; tourism: number; total: number; bookings: number } };
  finance?: { receivable: number; agencyCredit: number; collectedThisMonth: number; paymentsToVerify: number; paymentsToVerifyAmount: number; requestsToApprove: number };
  capacity?: { id: string; packageId: string; packageName: string; packageCode: string; vertical: Vertical; departureDate: string; capacity: number | null; seatsSold: number; seatsHeld: number; status: string }[];
}

function Tile({ label, value, hint, icon: Icon, tone, to }: { label: string; value: string; hint?: string; icon: LucideIcon; tone: string; to?: string }) {
  const body = (
    <Card className="flex h-full items-center gap-4 p-5 transition hover:shadow-md">
      <div className={`rounded-xl p-3 ${tone}`}><Icon className="size-6" /></div>
      <div className="min-w-0">
        <p className="truncate text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function AdminDashboard() {
  const me = useMe();
  const canSeeAgents = useCan("agent.view");
  const canReports = useCan("report.view");
  const { data, loading, error } = useApi<Dashboard>("/admin/dashboard");

  if (loading && !data) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;
  const cur = data.currency;
  const a = data.agencies;
  const queue = a ? (a.counts.pending_approval ?? 0) + (a.counts.information_required ?? 0) : 0;

  const tiles: { key: string; node: React.ReactNode }[] = [];
  if (a) tiles.push({ key: "agencies", node: <Tile label="Applications to review" value={String(queue)} hint={`${a.counts.active ?? 0} active agencies`} icon={Hourglass} tone="bg-gold-100 text-amber-700" to={canSeeAgents ? "/admin/agencies?status=queue" : undefined} /> });
  if (data.bookings) tiles.push({ key: "bookings", node: <Tile label="Bookings waiting for action" value={String(data.bookings.queue)} hint={`${data.bookings.documentsToCheck} documents to check`} icon={BookOpen} tone="bg-sky-50 text-sky-700" to="/admin/bookings?status=queue" /> });
  if (data.finance) {
    tiles.push({ key: "pay", node: <Tile label="Payments to verify" value={String(data.finance.paymentsToVerify)} hint={formatMoney(data.finance.paymentsToVerifyAmount, cur)} icon={Receipt} tone="bg-gold-100 text-amber-700" to="/admin/finance?tab=payments" /> });
    tiles.push({ key: "recv", node: <Tile label="Owed by agencies" value={formatMoney(data.finance.receivable, cur)} hint={`${data.finance.requestsToApprove} finance requests to approve`} icon={Wallet} tone="bg-accent-50 text-accent-600" to="/admin/finance" /> });
  }

  return (
    <div className="space-y-6">
      <div className="brand-pattern rounded-2xl p-6 text-white sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-gold-400">Admin portal</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Welcome, {me?.fullName}</h1>
        <p className="mt-1 text-brand-100">{formatDate(data.today)}</p>
      </div>

      {tiles.length > 0 && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{tiles.map((t) => <div key={t.key}>{t.node}</div>)}</div>}

      <div className="grid gap-6 2xl:grid-cols-3">
        {data.sales && (
          <Card className="2xl:col-span-2">
            <CardHeader icon={TrendingUp} title="Sales, last 6 months" description="Bookings charged to agencies (from the ledger), by product type." actions={canReports && <Link to="/admin/reports" className="text-sm font-medium text-brand-700 hover:underline">Reports</Link>} />
            <div className="p-5"><SalesChart months={data.sales.months} currency={cur} /></div>
          </Card>
        )}
        {(data.sales || data.finance) && (
          <Card>
            <CardHeader icon={Wallet} title="This month" />
            <dl className="space-y-3 p-5 text-sm">
              {data.sales && (
                <>
                  <div className="flex justify-between"><dt className="text-slate-500">Sales</dt><dd className="font-semibold text-slate-900">{formatMoney(data.sales.thisMonth.total, cur)}</dd></div>
                  {(["umrah", "hajj", "tourism"] as const).map((v) => (
                    <div key={v} className="flex justify-between pl-3 text-xs"><dt className="text-slate-500">{VERTICALS[v]}</dt><dd className="text-slate-700">{formatMoney(data.sales!.thisMonth[v], cur)}</dd></div>
                  ))}
                </>
              )}
              {data.bookings && <div className="flex justify-between"><dt className="text-slate-500">Bookings confirmed</dt><dd className="font-semibold text-slate-900">{data.bookings.confirmedThisMonth}</dd></div>}
              {data.finance && (
                <>
                  <div className="flex justify-between"><dt className="text-slate-500">Collected</dt><dd className="font-semibold text-slate-900">{formatMoney(data.finance.collectedThisMonth, cur)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Agency credit held</dt><dd className="font-semibold text-slate-900">{formatMoney(data.finance.agencyCredit, cur)}</dd></div>
                </>
              )}
            </dl>
          </Card>
        )}
      </div>

      <div className="grid gap-6 2xl:grid-cols-3">
        {data.capacity && (
          <Card className="overflow-hidden 2xl:col-span-2">
            <CardHeader icon={CalendarClock} title="Upcoming departures" description="Next 90 days: seats sold and held." />
            {data.capacity.length === 0 ? <EmptyState icon={CalendarClock} title="No departures in the next 90 days" /> : (
              <ul className="divide-y divide-slate-100">
                {data.capacity.map((d) => {
                  const used = d.seatsSold + d.seatsHeld;
                  const pctSold = d.capacity ? Math.min(100, (d.seatsSold / d.capacity) * 100) : 0;
                  const pctHeld = d.capacity ? Math.min(100 - pctSold, (d.seatsHeld / d.capacity) * 100) : 0;
                  return (
                    <li key={d.id}>
                      <Link to={`/admin/packages/${d.packageId}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-800">{d.packageName}</p>
                          <p className="text-xs text-slate-500">{formatDate(d.departureDate)} · {VERTICALS[d.vertical]}</p>
                        </div>
                        <div className="w-44">
                          {d.capacity ? (
                            <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-slate-100">
                              <div className="bg-brand-600" style={{ width: `${pctSold}%` }} />
                              <div className="bg-gold-400" style={{ width: `${pctHeld}%` }} />
                            </div>
                          ) : null}
                          <p className="mt-1 text-xs text-slate-500">{d.seatsSold} sold · {d.seatsHeld} held{d.capacity ? ` · ${Math.max(0, d.capacity - used)} left of ${d.capacity}` : " · no limit"}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {a && (
          <Card>
            <CardHeader icon={Hourglass} title="Applications to review" description="Oldest first" actions={canSeeAgents && <Link to="/admin/agencies?status=queue" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>} />
            {a.waitingForReview.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="All caught up">No applications are waiting.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {a.waitingForReview.map((x) => (
                  <li key={x.id}>
                    <Link to={`/admin/agencies/${x.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                      <Building2 className="size-5 text-brand-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-800">{x.agencyName}</p>
                        <p className="text-xs text-slate-500">{x.city} · registered {timeAgo(x.createdAt)}</p>
                      </div>
                      <StatusBadge status={x.status} />
                      <ArrowRight className="size-4 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-2 border-t border-slate-100 p-5">
              {(Object.keys(AGENCY_STATUS) as AgencyStatus[]).map((s) => (
                <li key={s} className={cx("flex items-center justify-between text-sm", !(a.counts[s] ?? 0) && "opacity-60")}>
                  <StatusBadge status={s} />
                  <span className="font-semibold text-slate-800">{a.counts[s] ?? 0}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {data.bookings && data.bookings.documentsToCheck > 0 && (
        <Alert tone="info" icon={FileSearch}>{data.bookings.documentsToCheck} passenger document{data.bookings.documentsToCheck === 1 ? " is" : "s are"} waiting to be checked. <Link to="/admin/bookings?status=queue" className="font-medium underline">Open the booking queue</Link></Alert>
      )}
    </div>
  );
}
