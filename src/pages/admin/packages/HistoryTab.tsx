import { History } from "lucide-react";
import { EmptyState, Spinner } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { formatDateTime, formatMoney } from "../../../utils/format";
import type { TabProps } from "./types";

interface Entry {
  id: string;
  description: string;
  oldValue: number | null;
  newValue: number | null;
  agencyName: string | null;
  agentCode: string | null;
  changedByName: string | null;
  createdAt: string;
}

/** Every price change on this package (prices, add-ons, agency special prices). */
export function HistoryTab({ pkg }: TabProps) {
  // Reload whenever the package changes (e.g. after saving prices).
  const { data, loading } = useApi<Entry[]>(`/admin/packages/${pkg.id}/price-history`, { v: pkg.updatedAt });
  if (loading && !data) return <Spinner />;
  if (!data?.length) return <EmptyState icon={History} title="No price changes yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4">When</th>
            <th className="py-2 pr-4">Price</th>
            <th className="py-2 pr-4">Agency</th>
            <th className="py-2 pr-4">Before</th>
            <th className="py-2 pr-4">After</th>
            <th className="py-2 pr-4">By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((e) => (
            <tr key={e.id}>
              <td className="py-2 pr-4 whitespace-nowrap text-slate-600">{formatDateTime(e.createdAt)}</td>
              <td className="py-2 pr-4 text-slate-800">{e.description}</td>
              <td className="py-2 pr-4 text-slate-600">{e.agencyName ? `${e.agencyName}${e.agentCode ? ` (${e.agentCode})` : ""}` : "All agencies"}</td>
              <td className="py-2 pr-4 text-slate-500">{formatMoney(e.oldValue, pkg.currency)}</td>
              <td className="py-2 pr-4 font-medium text-slate-800">{formatMoney(e.newValue, pkg.currency)}</td>
              <td className="py-2 pr-4 text-slate-600">{e.changedByName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
