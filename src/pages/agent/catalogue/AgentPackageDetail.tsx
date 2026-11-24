import { ArrowLeft, CalendarDays, Check, Clock, FileText, Hotel, MapPin, ShieldAlert, Users, Utensils, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PdfButton } from "../../../components/DocumentButtons";
import { useToast } from "../../../components/Toast";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Select, Spinner, cx } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { api, errorMessage } from "../../../utils/api";
import { PAX_TYPES, ROOM_TYPES, VERTICALS, formatDate, formatMoney, type Vertical } from "../../../utils/format";
import { describeSlab } from "../../admin/catalogue/CatalogueSetup";
import { IncludedChips } from "./AgentPackages";

interface Detail {
  id: string;
  code: string;
  vertical: Vertical;
  name: string;
  category: string | null;
  summary: string | null;
  description: string | null;
  bookingMode: "fixed_departure" | "on_request";
  durationDays: number | null;
  durationNights: number | null;
  seasonYear: number | null;
  destination: string | null;
  mealPlan: string | null;
  hotelCategory: string | null;
  minPax: number;
  maxGroupSize: number | null;
  flags: { visa: boolean; airTicket: boolean; transport: boolean; ziyarat: boolean };
  inclusions: string[];
  exclusions: string[];
  customFields: Record<string, string>;
  currency: string;
  hasBrochure: boolean;
  images: string[];
  hotels: { name: string; city: string; starRating: number | null; distanceToHaramM: number | null; nights: number; notes: string | null }[];
  itinerary: { dayNumber: number; title: string; description: string | null; city: string | null }[];
  departures: { id: string; departureDate: string; returnDate: string | null; bookingDeadline: string | null; seatsLeft: number | null; bookable: boolean; status: string }[];
  prices: { id: string; departureId: string | null; roomType: string; paxType: string; price: number; retailPrice: number | null }[];
  addons: { id: string; name: string; description: string | null; price: number; basis: "per_person" | "per_booking" }[];
  documentRequirements: { name: string; description: string | null; isRequired: boolean; appliesTo: string }[];
  cancellationPolicy: { name: string; description: string | null; slabs: { daysBefore: number; chargeType: "percent" | "fixed"; chargeValue: number }[] } | null;
}

export function AgentPackageDetail() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const { data: p, loading, error } = useApi<Detail>(`/agent/catalogue/packages/${id}`);
  const [image, setImage] = useState(0);
  const [departureId, setDepartureId] = useState<string>("");

  const firstBookable = p?.departures.find((d) => d.bookable)?.id ?? "";
  const selected = departureId || firstBookable;

  /** Prices for the chosen departure: a price set for that date wins over the general price. */
  const priceGrid = useMemo(() => {
    if (!p) return { rooms: [] as string[], pax: [] as string[], cell: () => undefined as Detail["prices"][number] | undefined };
    const pick = (room: string, pax: string) =>
      p.prices.find((r) => r.departureId === (selected || null) && r.roomType === room && r.paxType === pax) ??
      p.prices.find((r) => r.departureId === null && r.roomType === room && r.paxType === pax);
    const relevant = p.prices.filter((r) => r.departureId === null || r.departureId === selected);
    const rooms = Object.keys(ROOM_TYPES).filter((k) => relevant.some((r) => r.roomType === k));
    const pax = Object.keys(PAX_TYPES).filter((k) => relevant.some((r) => r.paxType === k));
    return { rooms, pax, cell: pick };
  }, [p, selected]);

  if (loading && !p) return <Spinner />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!p) return null;

  const selectedDeparture = p.departures.find((d) => d.id === selected);
  const canBook = p.bookingMode === "on_request" || !!selectedDeparture?.bookable;
  const startBooking = async () => {
    setStarting(true);
    try {
      const res = await api.post<{ id: string }>("/agent/bookings", { packageId: p.id, departureId: p.bookingMode === "on_request" ? null : selected || null });
      toast("success", res.message ?? "Draft started");
      navigate(`/agent/bookings/${res.data.id}`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const openBrochure = () => api.openFile(`/agent/catalogue/packages/${p.id}/brochure`).catch((e) => toast("error", errorMessage(e)));

  return (
    <div className="space-y-6">
      <Link to="/agent/packages" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" /> Packages</Link>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="space-y-3">
          <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-brand-50">
            {p.images.length ? <img src={p.images[image]} alt={p.name} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-brand-200"><MapPin className="size-12" /></div>}
          </div>
          {p.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {p.images.map((src, i) => (
                <button key={src} onClick={() => setImage(i)} className={cx("h-16 w-24 shrink-0 overflow-hidden rounded-lg ring-2", i === image ? "ring-brand-500" : "ring-transparent")}>
                  <img src={src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <Card className="flex flex-col p-6">
          <p className="text-sm font-semibold text-brand-700">{VERTICALS[p.vertical]}{p.seasonYear ? ` ${p.seasonYear}` : ""}{p.category ? ` · ${p.category}` : ""}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{p.name}</h1>
          <p className="text-xs text-slate-400">{p.code}</p>
          {p.summary && <p className="mt-3 text-slate-600">{p.summary}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {p.destination && <Fact icon={MapPin} label="Destination" value={p.destination} />}
            {p.durationDays && <Fact icon={Clock} label="Duration" value={`${p.durationDays} days${p.durationNights ? ` / ${p.durationNights} nights` : ""}`} />}
            {p.mealPlan && <Fact icon={Utensils} label="Meals" value={p.mealPlan} />}
            {p.hotelCategory && <Fact icon={Hotel} label="Hotels" value={p.hotelCategory} />}
            <Fact icon={Users} label="Group" value={`Min ${p.minPax}${p.maxGroupSize ? `, max ${p.maxGroupSize}` : ""} passengers`} />
          </dl>
          <div className="mt-4"><IncludedChips flags={p.flags} /></div>
          <div className="mt-auto space-y-2 pt-6">
            {p.bookingMode === "fixed_departure" && p.departures.length > 1 && (
              <Select value={selected} onChange={(e) => setDepartureId(e.target.value)} aria-label="Departure to book">
                {p.departures.filter((d) => d.bookable).map((d) => <option key={d.id} value={d.id}>{formatDate(d.departureDate)}{d.seatsLeft !== null ? ` · ${d.seatsLeft} seats left` : ""}</option>)}
              </Select>
            )}
            <Button className="w-full" size="lg" loading={starting} disabled={!canBook} onClick={startBooking}>
              {p.bookingMode === "on_request" ? "Request a quotation" : selectedDeparture ? `Book for ${formatDate(selectedDeparture.departureDate)}` : "Book this package"}
            </Button>
            {!canBook && <p className="text-center text-xs text-slate-500">No departure is open for booking right now.</p>}
            {p.hasBrochure && <Button variant="secondary" className="w-full" icon={FileText} onClick={openBrochure}>Download brochure</Button>}
            <div className="flex flex-wrap justify-center gap-2">
              <PdfButton path={`/agent/documents/packages/${p.id}/brochure`} label="Itinerary PDF (for clients)" variant="ghost" />
              <PdfButton path={`/agent/documents/packages/${p.id}/brochure?prices=true`} label="With my prices" variant="ghost" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader icon={CalendarDays} title="Departures" description={p.bookingMode === "on_request" ? "This package is booked on request: tell us your dates." : undefined} />
          {p.departures.length === 0 ? (
            <EmptyState icon={CalendarDays} title={p.bookingMode === "on_request" ? "Dates on request" : "No upcoming departures"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5">Departure</th><th className="px-4 py-2.5">Return</th><th className="px-4 py-2.5">Book by</th><th className="px-4 py-2.5">Seats</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {p.departures.map((d) => (
                    <tr key={d.id} className={cx(!d.bookable && "text-slate-400")}>
                      <td className="px-4 py-2.5 font-medium">{formatDate(d.departureDate)}</td>
                      <td className="px-4 py-2.5">{formatDate(d.returnDate)}</td>
                      <td className="px-4 py-2.5">{formatDate(d.bookingDeadline)}</td>
                      <td className="px-4 py-2.5">
                        {!d.bookable ? <Badge>{d.seatsLeft === 0 ? "Sold out" : "Closed"}</Badge> : d.seatsLeft === null ? "Available" : <span className={cx(d.seatsLeft <= 5 && "font-semibold text-accent-600")}>{d.seatsLeft} left</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Your prices"
            description="Per person, in your agency's prices"
            actions={p.departures.length > 1 && (
              <Select value={selected} onChange={(e) => setDepartureId(e.target.value)} className="w-52" aria-label="Departure">
                {p.departures.filter((d) => d.status !== "cancelled").map((d) => <option key={d.id} value={d.id}>{formatDate(d.departureDate)}</option>)}
              </Select>
            )}
          />
          {priceGrid.rooms.length === 0 ? (
            <EmptyState icon={Users} title="Prices on request" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5">Room</th>{priceGrid.pax.map((x) => <th key={x} className="px-4 py-2.5">{PAX_TYPES[x]}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {priceGrid.rooms.map((room) => (
                    <tr key={room}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{ROOM_TYPES[room]}</td>
                      {priceGrid.pax.map((pax) => {
                        const c = priceGrid.cell(room, pax);
                        return (
                          <td key={pax} className="px-4 py-2.5">
                            {c ? (
                              <>
                                <p className="font-semibold text-brand-700">{formatMoney(c.price, p.currency)}</p>
                                {c.retailPrice !== null && <p className="text-xs text-slate-400">Suggested sale {formatMoney(c.retailPrice, p.currency)}</p>}
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {p.addons.length > 0 && (
            <div className="border-t border-slate-100 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-700">Optional add-ons</p>
              <ul className="space-y-1 text-sm">
                {p.addons.map((a) => (
                  <li key={a.id} className="flex justify-between gap-4">
                    <span className="text-slate-700">{a.name}{a.description && <span className="text-slate-400"> · {a.description}</span>}</span>
                    <span className="shrink-0 font-medium text-slate-800">{formatMoney(a.price, p.currency)} <span className="text-xs font-normal text-slate-400">{a.basis === "per_person" ? "/ person" : "/ booking"}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {p.hotels.length > 0 && (
        <Card>
          <CardHeader icon={Hotel} title="Hotels" />
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {p.hotels.map((h, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-4">
                <p className="font-semibold text-slate-900">{h.name}</p>
                <p className="text-sm text-slate-500">{h.city}{h.starRating ? ` · ${"★".repeat(h.starRating)}` : ""}</p>
                <p className="mt-2 text-sm text-slate-700">{h.nights} nights{h.distanceToHaramM !== null ? ` · ${h.distanceToHaramM} m to the Haram` : ""}</p>
                {h.notes && <p className="text-xs text-slate-500">{h.notes}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {(p.description || p.itinerary.length > 0) && (
        <Card>
          <CardHeader icon={CalendarDays} title="Itinerary" />
          <div className="space-y-4 p-5">
            {p.description && <p className="whitespace-pre-line text-slate-700">{p.description}</p>}
            {p.itinerary.length > 0 && (
              <ol className="space-y-4">
                {p.itinerary.map((d) => (
                  <li key={d.dayNumber} className="relative border-l-2 border-brand-200 pl-5">
                    <span className="absolute top-0 -left-[11px] flex size-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{d.dayNumber}</span>
                    <p className="font-semibold text-slate-900">Day {d.dayNumber}: {d.title}{d.city && <span className="font-normal text-slate-500"> · {d.city}</span>}</p>
                    {d.description && <p className="mt-0.5 text-sm whitespace-pre-line text-slate-600">{d.description}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-4">
        <ListCard title="Included" items={p.inclusions} icon={<Check className="size-4 text-brand-600" />} />
        <ListCard title="Not included" items={p.exclusions} icon={<X className="size-4 text-accent-500" />} />
        <Card>
          <CardHeader icon={FileText} title="Documents needed" />
          {p.documentRequirements.length === 0 ? <p className="p-5 text-sm text-slate-500">Our team will tell you what is needed.</p> : (
            <ul className="space-y-2 p-5 text-sm">
              {p.documentRequirements.map((d) => (
                <li key={d.name}>
                  <p className="text-slate-800">{d.name} {!d.isRequired && <span className="text-xs text-slate-400">(optional)</span>}</p>
                  {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={ShieldAlert} title="Cancellation" />
          <div className="space-y-2 p-5 text-sm text-slate-700">
            {!p.cancellationPolicy ? <p className="text-slate-500">Ask our team for the cancellation terms.</p> : (
              <>
                <p className="font-medium">{p.cancellationPolicy.name}</p>
                {p.cancellationPolicy.description && <p className="text-slate-500">{p.cancellationPolicy.description}</p>}
                <ul className="list-inside list-disc">
                  {[...p.cancellationPolicy.slabs].sort((a, b) => b.daysBefore - a.daysBefore).map((s) => <li key={s.daysBefore}>{describeSlab(s, p.currency)}</li>)}
                </ul>
              </>
            )}
          </div>
        </Card>
      </div>

      {Object.keys(p.customFields).length > 0 && (
        <Card>
          <CardHeader title="Other details" />
          <dl className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(p.customFields).map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase text-slate-500">{k}</dt><dd className="text-sm text-slate-800">{v}</dd></div>)}
          </dl>
        </Card>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 text-brand-600" />
      <div><dt className="text-xs text-slate-500">{label}</dt><dd className="text-slate-800">{value}</dd></div>
    </div>
  );
}

function ListCard({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      {items.length === 0 ? <p className="p-5 text-sm text-slate-500">—</p> : (
        <ul className="space-y-1.5 p-5 text-sm text-slate-700">{items.map((i) => <li key={i} className="flex gap-2">{icon}{i}</li>)}</ul>
      )}
    </Card>
  );
}
