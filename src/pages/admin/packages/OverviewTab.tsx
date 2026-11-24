import { useEffect, useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Input, Select, Textarea } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { BOOKING_MODES } from "../../../utils/format";
import type { TabProps } from "./types";
import { useSave } from "./useSave";

const lines = (t: string) => t.split("\n").map((s) => s.trim()).filter(Boolean);

/** "Label: value" per line ⇄ { label: value } */
const toPairs = (t: string) =>
  Object.fromEntries(
    lines(t)
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()] as const)
      .filter(([k, v]) => k && v),
  );

export function OverviewTab({ pkg, onSaved, readOnly }: TabProps) {
  const { data: destinations } = useApi<{ id: string; city: string; country: string; verticals: string[]; isActive: boolean }[]>("/admin/catalogue/destinations", { vertical: pkg.vertical });
  const { data: policies } = useApi<{ id: string; name: string; isActive: boolean }[]>("/admin/catalogue/cancellation-policies");
  const { saving, errors, run, api } = useSave(onSaved);
  const [f, setF] = useState(() => toForm(pkg));
  useEffect(() => setF(toForm(pkg)), [pkg]);

  const set = (k: keyof ReturnType<typeof toForm>) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const flag = (k: "visaIncluded" | "airTicketIncluded" | "transportIncluded" | "ziyaratIncluded") => (e: { target: { checked: boolean } }) => setF((s) => ({ ...s, [k]: e.target.checked }));

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.patch(`/admin/packages/${pkg.id}`, {
        ...f,
        destinationId: f.destinationId || null,
        cancellationPolicyId: f.cancellationPolicyId || null,
        inclusions: lines(f.inclusions),
        exclusions: lines(f.exclusions),
        customFields: toPairs(f.customFields),
      }),
    );
  };

  const text = (k: keyof ReturnType<typeof toForm>, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} error={errors[k]}>
      <Input value={String(f[k] ?? "")} onChange={set(k)} invalid={!!errors[k]} disabled={readOnly} {...props} />
    </Field>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2">{text("name", "Package name")}</div>
        {text("category", "Category", { placeholder: "e.g. Economy, Premium" })}
        <Field label="How agents book it">
          <Select value={f.bookingMode} onChange={set("bookingMode")} disabled={readOnly}>
            {Object.entries(BOOKING_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {text("durationDays", "Duration (days)", { type: "number", min: 1 })}
        {text("durationNights", "Nights", { type: "number", min: 0 })}
        <Field label={pkg.vertical === "tourism" ? "Destination" : "Main city"} error={errors.destinationId} hint={destinations?.length === 0 ? "Add destinations in Catalogue setup" : undefined}>
          <Select value={f.destinationId} onChange={set("destinationId")} disabled={readOnly}>
            <option value="">—</option>
            {(destinations ?? []).filter((d) => d.isActive || d.id === f.destinationId).map((d) => <option key={d.id} value={d.id}>{d.city}, {d.country}</option>)}
          </Select>
        </Field>
        {pkg.vertical === "hajj" ? text("seasonYear", "Hajj season (year)", { type: "number", min: 2000 }) : text("hotelCategory", "Hotel category", { placeholder: "e.g. 4-star" })}
        <div className="md:col-span-2 xl:col-span-4">{text("summary", "Short summary (shown on the package card)", { maxLength: 300 })}</div>
        <Field label="Description" className="md:col-span-2 xl:col-span-4" error={errors.description}>
          <Textarea value={f.description} onChange={set("description")} disabled={readOnly} className="min-h-28" />
        </Field>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <p className="mb-3 text-sm font-semibold text-slate-700">Included in the price</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox label="Visa" checked={f.visaIncluded} onChange={flag("visaIncluded")} disabled={readOnly} />
          <Checkbox label="Air ticket" checked={f.airTicketIncluded} onChange={flag("airTicketIncluded")} disabled={readOnly} />
          <Checkbox label="Transport" checked={f.transportIncluded} onChange={flag("transportIncluded")} disabled={readOnly} />
          {pkg.vertical !== "tourism" && <Checkbox label="Ziyarat" checked={f.ziyaratIncluded} onChange={flag("ziyaratIncluded")} disabled={readOnly} />}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {text("mealPlan", "Meal plan", { placeholder: "e.g. Breakfast, Full board" })}
          {text("minPax", "Minimum passengers", { type: "number", min: 1 })}
          {text("maxGroupSize", "Maximum group size", { type: "number", min: 1 })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Inclusions" hint="One per line" error={errors.inclusions}>
          <Textarea value={f.inclusions} onChange={set("inclusions")} disabled={readOnly} className="min-h-32" />
        </Field>
        <Field label="Exclusions" hint="One per line" error={errors.exclusions}>
          <Textarea value={f.exclusions} onChange={set("exclusions")} disabled={readOnly} className="min-h-32" />
        </Field>
        <Field label="Other details" hint="One per line as Label: value, e.g. Flight: Direct from Lahore" error={errors.customFields}>
          <Textarea value={f.customFields} onChange={set("customFields")} disabled={readOnly} className="min-h-32" />
        </Field>
      </div>

      <Field label="Cancellation policy" className="md:w-1/2" hint={policies?.length === 0 ? "Add policies in Catalogue setup" : undefined}>
        <Select value={f.cancellationPolicyId} onChange={set("cancellationPolicyId")} disabled={readOnly}>
          <option value="">None</option>
          {(policies ?? []).filter((p) => p.isActive || p.id === f.cancellationPolicyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>

      {!readOnly && <Button type="submit" loading={saving}>Save overview</Button>}
    </form>
  );
}

function toForm(p: TabProps["pkg"]) {
  return {
    name: p.name,
    category: p.category ?? "",
    bookingMode: p.bookingMode as string,
    summary: p.summary ?? "",
    description: p.description ?? "",
    durationDays: p.durationDays?.toString() ?? "",
    durationNights: p.durationNights?.toString() ?? "",
    destinationId: p.destinationId ?? "",
    seasonYear: p.seasonYear?.toString() ?? "",
    hotelCategory: p.hotelCategory ?? "",
    mealPlan: p.mealPlan ?? "",
    minPax: String(p.minPax),
    maxGroupSize: p.maxGroupSize?.toString() ?? "",
    visaIncluded: p.visaIncluded,
    airTicketIncluded: p.airTicketIncluded,
    transportIncluded: p.transportIncluded,
    ziyaratIncluded: p.ziyaratIncluded,
    inclusions: p.inclusions.join("\n"),
    exclusions: p.exclusions.join("\n"),
    customFields: Object.entries(p.customFields).map(([k, v]) => `${k}: ${v}`).join("\n"),
    cancellationPolicyId: p.cancellationPolicyId ?? "",
  };
}
