import { BadgePercent } from "lucide-react";
import { useEffect, useState } from "react";
import { useBranding } from "../../branding/BrandingProvider";
import { useToast } from "../../components/Toast";
import { Button, Card, CardHeader, Detail, Field, Input, Select } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useCan } from "../../redux/hooks";
import { api, errorMessage } from "../../utils/api";
import { describeAdjustment } from "./pricing/Pricing";

interface Group { id: string; name: string; adjustmentType: "percent" | "fixed"; adjustmentValue: number; isDefault: boolean; isActive: boolean }

/** Pricing group and internal category of an agency (decides the prices the agency sees). */
export function AgencyCommercialCard({ agencyId, pricingGroupId, agentCategory, onSaved }: { agencyId: string; pricingGroupId: string | null; agentCategory: string | null; onSaved: () => void }) {
  const toast = useToast();
  const { currency } = useBranding();
  const canPrice = useCan("pricing.manage");
  const { data: groups } = useApi<Group[]>("/admin/pricing-groups");
  const [groupId, setGroupId] = useState(pricingGroupId ?? "");
  const [category, setCategory] = useState(agentCategory ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setGroupId(pricingGroupId ?? "");
    setCategory(agentCategory ?? "");
  }, [pricingGroupId, agentCategory]);

  const current = groups?.find((g) => g.id === pricingGroupId);
  const fallback = groups?.find((g) => g.isDefault && g.isActive);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/admin/agencies/${agencyId}/commercial`, { pricingGroupId: groupId || null, agentCategory: category || null });
      toast("success", res.message ?? "Saved");
      onSaved();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={BadgePercent} title="Prices for this agency" />
      <div className="space-y-4 p-5">
        {canPrice ? (
          <>
            <Field label="Pricing group" hint={!groupId && fallback ? `Not set: uses the default group (${fallback.name})` : undefined}>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Default group</option>
                {(groups ?? []).filter((g) => g.isActive || g.id === groupId).map((g) => (
                  <option key={g.id} value={g.id}>{g.name} · {describeAdjustment(g, currency)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Agent category" hint="Internal label, e.g. A, B, C">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={50} />
            </Field>
            <Button size="sm" loading={saving} onClick={save}>Save</Button>
          </>
        ) : (
          <dl className="space-y-3">
            <Detail label="Pricing group">{current ? `${current.name} · ${describeAdjustment(current, currency)}` : fallback ? `Default (${fallback.name})` : "Package prices as set"}</Detail>
            <Detail label="Agent category">{agentCategory ?? ""}</Detail>
          </dl>
        )}
      </div>
    </Card>
  );
}
