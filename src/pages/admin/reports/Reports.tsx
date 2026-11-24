import { BarChart3, FileSpreadsheet, FileText, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { PdfButton } from "../../../components/DocumentButtons";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage } from "../../../utils/api";
import { formatDate } from "../../../utils/format";

interface ReportDef {
  key: string;
  title: string;
  description: string;
  range: boolean;
  groupBy: { value: string; label: string }[];
}
interface Column {
  key: string;
  label: string;
  type: "text" | "money" | "number" | "date" | "percent";
}
interface Report {
  key: string;
  title: string;
  subtitle: string;
  currency: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
}

function cell(v: unknown, c: Column) {
  if (v === null || v === undefined || v === "") return "";
  if (c.type === "money") return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (c.type === "number") return Number(v).toLocaleString("en-US");
  if (c.type === "percent") return `${v}%`;
  if (c.type === "date") return formatDate(String(v));
  return String(v);
}

export function Reports() {
  const { data: catalogue, loading } = useApi<{ defaults: { from: string; to: string; asOf: string }; reports: ReportDef[] }>("/admin/reports");
  const [key, setKey] = useState("");
  const [params, setParams] = useState({ from: "", to: "", asOf: "", groupBy: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalogue || key) return;
    const first = catalogue.reports[0];
    if (!first) return;
    setKey(first.key);
    setParams({ ...catalogue.defaults, groupBy: first.groupBy[0]?.value ?? "" });
  }, [catalogue, key]);

  if (loading && !catalogue) return <Spinner />;
  if (!catalogue?.reports.length) return <EmptyState icon={BarChart3} title="No reports available for your role" />;
  const def = catalogue.reports.find((r) => r.key === key);

  const query = () => {
    const q = new URLSearchParams();
    if (def?.range) {
      q.set("from", params.from);
      q.set("to", params.to);
    } else q.set("asOf", params.asOf);
    if (def?.groupBy.length && params.groupBy) q.set("groupBy", params.groupBy);
    return q;
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await api.get<Report>(`/admin/reports/${key}?${query().toString()}`));
    } catch (e) {
      setError(errorMessage(e));
      setReport(null);
    } finally {
      setRunning(false);
    }
  };

  const choose = (k: string) => {
    const d = catalogue.reports.find((r) => r.key === k);
    setKey(k);
    setReport(null);
    setParams((p) => ({ ...p, groupBy: d?.groupBy[0]?.value ?? "" }));
  };

  const exportPath = (format: "xlsx" | "pdf") => {
    const q = query();
    q.set("format", format);
    return `/admin/reports/${key}?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Figures come from the ledger and bookings. Export to Excel or PDF." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {catalogue.reports.map((r) => (
          <button key={r.key} onClick={() => choose(r.key)} className={cx("rounded-xl p-4 text-left ring-1 transition", key === r.key ? "bg-brand-50 ring-brand-500" : "bg-white ring-slate-200 hover:ring-brand-300")}>
            <p className="font-semibold text-slate-900">{r.title}</p>
            <p className="mt-1 text-sm text-slate-500">{r.description}</p>
          </button>
        ))}
      </div>

      {def && (
        <Card className="overflow-hidden">
          <CardHeader icon={BarChart3} title={def.title} />
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 pb-4">
            {def.range ? (
              <>
                <Field label="From"><Input type="date" value={params.from} onChange={(e) => setParams({ ...params, from: e.target.value })} /></Field>
                <Field label="To"><Input type="date" value={params.to} onChange={(e) => setParams({ ...params, to: e.target.value })} /></Field>
              </>
            ) : (
              <Field label="As of"><Input type="date" value={params.asOf} onChange={(e) => setParams({ ...params, asOf: e.target.value })} /></Field>
            )}
            {def.groupBy.length > 0 && (
              <Field label="Group by">
                <Select value={params.groupBy} onChange={(e) => setParams({ ...params, groupBy: e.target.value })}>
                  {def.groupBy.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </Select>
              </Field>
            )}
            <Button icon={Play} loading={running} onClick={run}>Run report</Button>
            {report && (
              <>
                <PdfButton path={exportPath("xlsx")} label="Excel" icon={FileSpreadsheet} download />
                <PdfButton path={exportPath("pdf")} label="PDF" icon={FileText} />
              </>
            )}
          </div>
          {error && <Alert tone="error" className="m-5">{error}</Alert>}
          {!report && !error && <p className="p-5 text-sm text-slate-500">Choose the period and run the report.</p>}
          {report && (
            <>
              <p className="px-5 pt-4 text-sm text-slate-500">{report.subtitle} · amounts in {report.currency}</p>
              <div className="overflow-x-auto p-5 pt-3">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>{report.columns.map((c) => <th key={c.key} className={cx("px-3 py-2.5", c.type !== "text" && c.type !== "date" && "text-right")}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.length === 0 && <tr><td colSpan={report.columns.length} className="px-3 py-6 text-center text-slate-500">No figures in this period.</td></tr>}
                    {report.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {report.columns.map((c) => <td key={c.key} className={cx("px-3 py-2", c.type !== "text" && c.type !== "date" ? "text-right whitespace-nowrap" : "text-slate-800")}>{cell(row[c.key], c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  {report.totals && report.rows.length > 0 && (
                    <tfoot className="border-t-2 border-slate-200 font-semibold">
                      <tr>{report.columns.map((c) => <td key={c.key} className={cx("px-3 py-2.5", c.type !== "text" && c.type !== "date" && "text-right whitespace-nowrap")}>{cell(report.totals![c.key], c)}</td>)}</tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
