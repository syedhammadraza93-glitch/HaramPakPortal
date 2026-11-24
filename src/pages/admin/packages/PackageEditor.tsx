import { AlertTriangle, Archive, ArrowLeft, Copy, Eye, EyeOff, RotateCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PdfButton } from "../../../components/DocumentButtons";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Card, Spinner, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage } from "../../../utils/api";
import { PACKAGE_STATUS, VERTICALS, formatDateTime } from "../../../utils/format";
import { AddonsTab } from "./AddonsTab";
import { DeparturesTab } from "./DeparturesTab";
import { HistoryTab } from "./HistoryTab";
import { HotelsTab } from "./HotelsTab";
import { ItineraryTab } from "./ItineraryTab";
import { MediaTab } from "./MediaTab";
import { OverviewTab } from "./OverviewTab";
import { PricesTab } from "./PricesTab";
import { SpecialPricesTab } from "./SpecialPricesTab";
import type { PackageDetail } from "./types";

type TabKey = "overview" | "hotels" | "itinerary" | "departures" | "prices" | "addons" | "media" | "special" | "history";

export function PackageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canManage = useCan("catalogue.manage");
  const canPrice = useCan("pricing.manage");
  const { data, loading, error, setData } = useApi<PackageDetail>(`/admin/packages/${id}`);
  const [tab, setTab] = useState<TabKey>("overview");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setTab("overview"), [id]);

  if (loading && !data) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;
  const pkg = data;
  const archived = pkg.status === "archived";
  const onSaved = (p: PackageDetail) => setData(p);

  const tabs: { key: TabKey; label: string; count?: number; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "hotels", label: "Hotels", count: pkg.hotels.length, show: true },
    { key: "itinerary", label: "Itinerary", count: pkg.itinerary.length, show: true },
    { key: "departures", label: "Departures", count: pkg.departures.length, show: true },
    { key: "prices", label: "Prices", count: pkg.rates.length, show: true },
    { key: "addons", label: "Add-ons", count: pkg.addons.length, show: true },
    { key: "media", label: "Images & brochure", count: pkg.images.length, show: true },
    { key: "special", label: "Agency special prices", count: pkg.agencySpecialPrices, show: canPrice },
    { key: "history", label: "Price history", show: true },
  ];

  const action = async (name: string) => {
    setBusy(name);
    try {
      if (name === "duplicate") {
        const res = await api.post<{ id: string }>(`/admin/packages/${pkg.id}/duplicate`);
        toast("success", res.message ?? "Copied");
        navigate(`/admin/packages/${res.data.id}`);
        return;
      }
      const res = await api.post<PackageDetail>(`/admin/packages/${pkg.id}/status/${name}`);
      setData(res.data);
      toast("success", res.message ?? "Done");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const props = { pkg, onSaved, readOnly: archived || !canManage };

  return (
    <div className="space-y-5">
      <Link to="/admin/packages" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="size-4" /> Packages
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{pkg.name}</h1>
            <Badge tone={PACKAGE_STATUS[pkg.status]?.tone}>{PACKAGE_STATUS[pkg.status]?.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {pkg.code} · {VERTICALS[pkg.vertical]}{pkg.category ? ` · ${pkg.category}` : ""} · updated {formatDateTime(pkg.updatedAt)}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {(pkg.status === "draft" || pkg.status === "unpublished") && (
              <Button icon={Send} loading={busy === "publish"} onClick={() => action("publish")} disabled={pkg.publishProblems.length > 0} title={pkg.publishProblems.join("\n")}>
                Publish
              </Button>
            )}
            {pkg.status === "published" && <Button variant="secondary" icon={EyeOff} loading={busy === "unpublish"} onClick={() => action("unpublish")}>Unpublish</Button>}
            <PdfButton path={`/admin/documents/packages/${pkg.id}/brochure`} label="Itinerary PDF" size="md" />
            {!archived && <Button variant="secondary" icon={Copy} loading={busy === "duplicate"} onClick={() => action("duplicate")}>Duplicate</Button>}
            {!archived && <Button variant="ghost" icon={Archive} loading={busy === "archive"} onClick={() => window.confirm("Archive this package? It will be hidden from agents and can no longer be edited until restored.") && action("archive")}>Archive</Button>}
            {archived && <Button variant="secondary" icon={RotateCcw} loading={busy === "restore"} onClick={() => action("restore")}>Restore</Button>}
          </div>
        )}
      </div>

      {pkg.status !== "published" && !archived && pkg.publishProblems.length > 0 && (
        <Alert tone="warning" icon={AlertTriangle} title="Before you can publish">
          <ul className="list-inside list-disc">
            {pkg.publishProblems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </Alert>
      )}
      {pkg.status === "published" && (
        <Alert tone="success" icon={Eye}>Agents can see this package. Price changes apply to new bookings right away.</Alert>
      )}
      {archived && <Alert tone="info">This package is archived and read-only. Restore it to make changes.</Alert>}

      <Card className="overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                "-mb-px shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition",
                tab === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === "overview" && <OverviewTab {...props} />}
          {tab === "hotels" && <HotelsTab {...props} />}
          {tab === "itinerary" && <ItineraryTab {...props} />}
          {tab === "departures" && <DeparturesTab {...props} />}
          {tab === "prices" && <PricesTab {...props} readOnly={archived || !canPrice} />}
          {tab === "addons" && <AddonsTab {...props} readOnly={archived || !canPrice} />}
          {tab === "media" && <MediaTab {...props} />}
          {tab === "special" && canPrice && <SpecialPricesTab {...props} readOnly={archived} />}
          {tab === "history" && <HistoryTab {...props} />}
        </div>
      </Card>
    </div>
  );
}
