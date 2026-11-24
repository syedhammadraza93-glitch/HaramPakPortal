import { CalendarPlus, Pencil, Plane, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Modal } from "../../../components/Modal";
import { PdfButton } from "../../../components/DocumentButtons";
import { useCan } from "../../../redux/hooks";
import { Badge, Button, EmptyState, Field, Input, Select } from "../../../components/ui";
import { formatDate } from "../../../utils/format";
import type { Departure, TabProps } from "./types";
import { useSave } from "./useSave";

const STATUS_TONE = { open: "green", closed: "amber", cancelled: "red" } as const;
const EMPTY = { departureDate: "", returnDate: "", bookingDeadline: "", capacity: "", status: "open", notes: "" };

export function DeparturesTab({ pkg, onSaved, readOnly }: TabProps) {
  const { saving, errors, run, api } = useSave(onSaved);
  const canSeeBookings = useCan("booking.view");
  const [editing, setEditing] = useState<Departure | "new" | null>(null);
  const [f, setF] = useState(EMPTY);

  const open = (d: Departure | "new") => {
    setF(d === "new" ? EMPTY : { departureDate: d.departureDate, returnDate: d.returnDate ?? "", bookingDeadline: d.bookingDeadline ?? "", capacity: d.capacity?.toString() ?? "", status: d.status, notes: d.notes ?? "" });
    setEditing(d);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...f, returnDate: f.returnDate || null, bookingDeadline: f.bookingDeadline || null, capacity: f.capacity || null, notes: f.notes || null };
    const done = await run(() => (editing === "new" ? api.post(`/admin/packages/${pkg.id}/departures`, body) : api.put(`/admin/packages/${pkg.id}/departures/${(editing as Departure).id}`, body)));
    if (done) setEditing(null);
  };

  const remove = (d: Departure) => {
    if (window.confirm(`Delete the departure on ${formatDate(d.departureDate)}?`)) void run(() => api.del(`/admin/packages/${pkg.id}/departures/${d.id}`));
  };

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      {pkg.bookingMode === "on_request" && (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">This package is booked on request, so departure dates are optional. Add dates if you have fixed groups.</p>
      )}
      {pkg.departures.length === 0 ? (
        <EmptyState icon={Plane} title="No departures yet">Add the travel dates agents can book, with seats and a booking deadline.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Departure</th>
                <th className="py-2 pr-4">Return</th>
                <th className="py-2 pr-4">Booking deadline</th>
                <th className="py-2 pr-4">Seats</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Note</th>
                {canSeeBookings && <th className="py-2 pr-4" />}
                {!readOnly && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pkg.departures.map((d) => (
                <tr key={d.id}>
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{formatDate(d.departureDate)}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{formatDate(d.returnDate)}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{formatDate(d.bookingDeadline)}</td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {d.capacity === null ? "Not limited" : `${d.capacity - d.seatsHeld - d.seatsSold} left of ${d.capacity}`}
                  </td>
                  <td className="py-2.5 pr-4"><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge></td>
                  <td className="py-2.5 pr-4 text-slate-500">{d.notes}</td>
                  {canSeeBookings && <td className="py-2.5 pr-4 whitespace-nowrap">{d.seatsSold + d.seatsHeld > 0 && <PdfButton path={`/admin/documents/departures/${d.id}/passenger-list`} label="Passenger list" variant="ghost" />}</td>}
                  {!readOnly && (
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => open(d)}>Edit</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(d)} aria-label="Delete departure" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && <Button icon={CalendarPlus} onClick={() => open("new")}>Add departure</Button>}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add departure" : "Edit departure"}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="departure-form" loading={saving}>Save</Button></>}
      >
        <form id="departure-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Departure date" required error={errors.departureDate}><Input type="date" value={f.departureDate} onChange={set("departureDate")} invalid={!!errors.departureDate} /></Field>
          <Field label="Return date" error={errors.returnDate}><Input type="date" value={f.returnDate} onChange={set("returnDate")} invalid={!!errors.returnDate} /></Field>
          <Field label="Booking deadline" error={errors.bookingDeadline} hint="Last day agents can book"><Input type="date" value={f.bookingDeadline} onChange={set("bookingDeadline")} invalid={!!errors.bookingDeadline} /></Field>
          <Field label="Seats" error={errors.capacity} hint="Leave empty if not limited"><Input type="number" min={1} value={f.capacity} onChange={set("capacity")} invalid={!!errors.capacity} /></Field>
          <Field label="Status">
            <Select value={f.status} onChange={set("status")}>
              <option value="open">Open for booking</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Note" error={errors.notes}><Input value={f.notes} onChange={set("notes")} maxLength={200} placeholder="e.g. Flight from Lahore" /></Field>
        </form>
      </Modal>
    </div>
  );
}
