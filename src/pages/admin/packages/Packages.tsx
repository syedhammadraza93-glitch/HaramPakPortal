import { Package as PackageIcon, Plus, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pagination, Select, Spinner, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useCan } from "../../../redux/hooks";
import { api, errorMessage, fieldErrors } from "../../../utils/api";
import { BOOKING_MODES, PACKAGE_STATUS, VERTICALS, formatDate, formatMoney, type Vertical } from "../../../utils/format";
import { useBranding } from "../../../branding/BrandingProvider";

interface Row {
  id: string;
  code: string;
  vertical: Vertical;
  name: string;
  category: string | null;
  status: string;
  durationDays: number | null;
  seasonYear: number | null;
  destination: string | null;
  nextDeparture: string | null;
  fromPrice: number | null;
  coverUrl: string | null;
  updatedAt: string;
}

const TABS: { key: "" | Vertical; label: string }[] = [{ key: "", label: "All" }, ...(Object.entries(VERTICALS) as [Vertical, string][]).map(([key, label]) => ({ key, label }))];

export function Packages() {
  const navigate = useNavigate();
  const toast = useToast();
  const { currency } = useBranding();
  const canManage = useCan("catalogue.manage");
  const [params, setParams] = useSearchParams();
  const vertical = (params.get("vertical") ?? "") as "" | Vertical;
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);
  const search = params.get("search") ?? "";
  const [term, setTerm] = useState(search);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ vertical: "umrah" as Vertical, name: "", category: "", bookingMode: "fixed_departure" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const setParam = (key: string, value: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (value) n.set(key, value);
      else n.delete(key);
      if (key !== "page") n.delete("page");
      return n;
    });

  useEffect(() => {
    const t = setTimeout(() => term !== search && setParam("search", term), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const { data, loading, error } = useApi<{ items: Row[]; total: number; page: number; pageSize: number }>("/admin/packages", {
    vertical: vertical || undefined, status: status || undefined, search: search || undefined, page,
  });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await api.post<{ id: string }>("/admin/packages", form);
      toast("success", res.message ?? "Draft created");
      navigate(`/admin/packages/${res.data.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Packages"
        description="Umrah, Hajj and tour packages. Agents only see published packages, with their own prices."
        actions={canManage && <Button icon={Plus} onClick={() => { setForm({ vertical: vertical || "umrah", name: "", category: "", bookingMode: "fixed_departure" }); setCreating(true); }}>New package</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setParam("vertical", t.key)}
              className={cx("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition", vertical === t.key ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={status} onChange={(e) => setParam("status", e.target.value)} className="sm:w-44">
            <option value="">Not archived</option>
            {Object.entries(PACKAGE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <div className="relative sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name, code or category" className="pl-9" />
          </div>
        </div>
      </div>

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState icon={PackageIcon} title="No packages yet">{canManage ? "Create a package, add hotels, dates and prices, then publish it." : undefined}</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Next departure</th>
                    <th className="px-4 py-3">From (adult)</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/admin/packages/${p.id}`)} className={cx("cursor-pointer hover:bg-brand-50/40", loading && "opacity-60")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                            {p.coverUrl ? <img src={p.coverUrl} alt="" className="size-full object-cover" /> : <PackageIcon className="m-3.5 size-5 text-slate-300" />}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{p.name}</p>
                            <p className="text-xs text-slate-500">{p.code}{p.category ? ` · ${p.category}` : ""}{p.destination ? ` · ${p.destination}` : ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{VERTICALS[p.vertical]}{p.seasonYear ? ` ${p.seasonYear}` : ""}</td>
                      <td className="px-4 py-3 text-slate-600">{p.durationDays ? `${p.durationDays} days` : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(p.nextDeparture)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatMoney(p.fromPrice, currency)}</td>
                      <td className="px-4 py-3"><Badge tone={PACKAGE_STATUS[p.status]?.tone}>{PACKAGE_STATUS[p.status]?.label}</Badge></td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDate(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParam("page", String(p))} />
          </>
        )}
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New package"
        description="It starts as a draft. Agents see it only after you publish it."
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" form="new-package" loading={saving}>Create draft</Button></>}
      >
        <form id="new-package" onSubmit={create} className="space-y-4">
          <Field label="Product type" required>
            <Select value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value as Vertical })}>
              {Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Package name" required error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} placeholder="e.g. 15 Days Economy Umrah" autoFocus />
          </Field>
          <Field label="Category" hint="Optional, e.g. Economy, Premium, Package B" error={errors.category}>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label="How agents book it">
            <Select value={form.bookingMode} onChange={(e) => setForm({ ...form, bookingMode: e.target.value })}>
              {Object.entries(BOOKING_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>
    </div>
  );
}
