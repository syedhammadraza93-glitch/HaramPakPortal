import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "../../components/Toast";
import { Button, Card, CardHeader, Field, Input, Spinner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api, errorMessage, fieldErrors } from "../../utils/api";

/** Settings → Bookings: seat hold time and passport validity rule. */
export function BookingSettingsCard() {
  const toast = useToast();
  const { data } = useApi<{ seatHoldHours: number; passportValidityMonths: number }>("/admin/booking-setup/settings");
  const [f, setF] = useState({ seatHoldHours: "", passportValidityMonths: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setF({ seatHoldHours: String(data.seatHoldHours), passportValidityMonths: String(data.passportValidityMonths) });
  }, [data]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const res = await api.put("/admin/booking-setup/settings", { seatHoldHours: Number(f.seatHoldHours), passportValidityMonths: Number(f.passportValidityMonths) });
      toast("success", res.message ?? "Saved");
    } catch (err) {
      setErrors(fieldErrors(err));
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Bookings" />
      {!data ? <Spinner /> : (
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Seat hold (hours)" error={errors.seatHoldHours} hint="Seats of a submitted booking are released if it is not confirmed in this time.">
            <Input type="number" min={1} value={f.seatHoldHours} onChange={(e) => setF({ ...f, seatHoldHours: e.target.value })} invalid={!!errors.seatHoldHours} />
          </Field>
          <Field label="Passport validity after return (months)" error={errors.passportValidityMonths} hint="0 = only check that the passport has not expired.">
            <Input type="number" min={0} value={f.passportValidityMonths} onChange={(e) => setF({ ...f, passportValidityMonths: e.target.value })} invalid={!!errors.passportValidityMonths} />
          </Field>
          <div className="sm:col-span-2"><Button loading={saving} onClick={save}>Save booking settings</Button></div>
        </div>
      )}
    </Card>
  );
}
