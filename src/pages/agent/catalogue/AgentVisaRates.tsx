import { Stamp } from "lucide-react";
import { Alert, Card, EmptyState, PageHeader, Spinner } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { formatDate, formatMoney } from "../../../utils/format";

interface VisaRate {
  id: string;
  name: string;
  category: string;
  visaFee: number;
  serviceFee: number;
  otherCharges: number;
  total: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

/** Umrah visa fees and service charges valid today. */
export function AgentVisaRates() {
  const { data, loading, error } = useApi<VisaRate[]>("/agent/catalogue/visa-rates");
  return (
    <div>
      <PageHeader title="Visa rates" description="Current Umrah visa fees and service charges." />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner /> : !data?.length ? (
          <EmptyState icon={Stamp} title="No visa rates published">Contact our team for current visa rates.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Visa</th><th className="px-4 py-3">Visa fee</th><th className="px-4 py-3">Service fee</th><th className="px-4 py-3">Other</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Valid</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-3"><p className="font-medium text-slate-800">{v.name}</p><p className="text-xs text-slate-500">{v.category}{v.notes ? ` · ${v.notes}` : ""}</p></td>
                    <td className="px-4 py-3 text-slate-600">{formatMoney(v.visaFee, v.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatMoney(v.serviceFee, v.currency)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatMoney(v.otherCharges, v.currency)}</td>
                    <td className="px-4 py-3 text-base font-bold text-brand-700">{formatMoney(v.total, v.currency)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">from {formatDate(v.effectiveFrom)}{v.effectiveTo ? ` to ${formatDate(v.effectiveTo)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
