import { hotelQuoteLine, quoteCurrencies, type DraftLine, type StayPricing } from "../../../utils/hotelQuote";
import { useState } from "react";
import { api } from "../../../utils/api";
import { matchesHotel, normalizeHotelText, suggestHotelStays, type HotelMatchFields, type HotelStay } from "../../../utils/hotelSearch";

type Hotel = HotelMatchFields & {
  id: string; name: string; city: string; address?: string | null; distanceReference: string | null;
  distanceVerifiedOn: string | null; shuttleAvailable: boolean | null; indicativeNightlySar: number | null;
};

const field = "w-full rounded-md border bg-white p-2 text-sm";
const button = "rounded-md border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50";
const blank = (city: HotelStay["city"] = "Makkah"): HotelStay => ({ city, location: "", stars: [], min: "", max: "" });
const cityAliases = { Makkah: ["makkah", "mecca"], Madinah: ["madinah", "madina", "medina"] };

export default function HotelEnquiry({ path, travelDate, travellers, onPrice, onSave }: {
  path: string; travelDate?: string | null; travellers?: number | null;
  onPrice: (lines: DraftLine[], currency: string) => boolean; onSave: (summary: string) => Promise<boolean>;
}) {
  const [enquiry, setEnquiry] = useState("");
  const [stays, setStays] = useState<HotelStay[]>([]);
  const [catalogue, setCatalogue] = useState<Hotel[]>();
  const [selected, setSelected] = useState<Record<number, Hotel>>({});
  const [pricing, setPricing] = useState<Record<number, StayPricing>>({});
  const [currency, setCurrency] = useState("SAR");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  function update(index: number, patch: Partial<HotelStay>) {
    setStays(current => current.map((stay, i) => i === index ? { ...stay, ...patch } : stay));
    setSelected(current => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    setNotice("");
  }

  async function search() {
    const suggestions = suggestHotelStays(enquiry);
    setStays(suggestions.length ? suggestions : [blank("Makkah"), blank("Madinah")]);
    setPricing({});
    setCatalogue(undefined);
    setBusy(true);
    setNotice("");
    setSelected({});
    try {
      setCatalogue(await api.get<Hotel[]>(path + "/hotel-catalogue"));
    } catch (error) {
      setCatalogue(undefined);
      setNotice(error instanceof Error ? error.message : "Hotel catalogue could not be loaded.");
    } finally { setBusy(false); }
  }

  function setPrice(index: number, patch: Partial<StayPricing>) {
    setPricing(current => ({ ...current, [index]: { ...current[index], ...patch } }));
  }

  function priceShortlist() {
    const choices = Object.entries(selected);
    const lines = choices.map(([index, hotel]) => hotelQuoteLine(hotel.name, pricing[Number(index)]));
    if (lines.some(line => !line)) {
      setNotice("Check dates, room and guest counts, confirmed capacity, and the nightly selling rate for each shortlisted hotel.");
      return;
    }
    if (onPrice(lines.filter(line => line !== undefined).map(line => ({ ...line, label: line.label.slice(0, 155) + " · On request" })), currency)) setNotice("Hotel prices added to the quote below.");
  }

  async function save() {
    const summary = stays.flatMap((stay, index) => {
      const hotel = selected[index];
      if (!hotel) return [];
      const distance = hotel.distanceToHaramM === null ? "distance unknown"
        : hotel.distanceToHaramM + " m" + (hotel.distanceReference ? " to " + hotel.distanceReference : "") + (hotel.distanceVerifiedOn ? "" : " (unverified)");
      return [`Stay ${index + 1} · ${stay.city}: ${hotel.name} · ${distance}`];
    }).join("\n");
    if (!summary) return;
    const note = "Hotel shortlist — confirm room occupancy, dates, availability and rates before quoting.\n" + summary;
    if (note.length > 1500) {
      setNotice("This shortlist is too long for one activity note. Save fewer stays at a time.");
      return;
    }
    setBusy(true);
    try {
      if (await onSave(note)) {
        setNotice("Hotel shortlist saved to the lead activity timeline.");
      }
    } finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-lg border bg-white p-4">
    <h2 className="font-semibold">Find hotels from enquiry</h2>
    <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      if (!busy) void search();
    }}>
      <label className="grid gap-1 text-sm">Enter the customer’s hotel requirements
        <textarea value={enquiry} onChange={event => setEnquiry(event.target.value)} maxLength={6000} disabled={busy}
          placeholder="Makkah on Ibrahim Khalil Road, Madinah in Markaziyah, 300–400 m, 3 or 4 stars"
          className={field + " min-h-24"} />
      </label>
      <button type="submit" className="rounded-md bg-brand-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>
        {busy && !catalogue ? "Searching…" : "Search hotels"}
      </button>
    </form>
    {catalogue && (
      <button type="button" className={button} disabled={busy || stays.length >= 8}
        onClick={() => setStays([...stays, blank(stays.at(-1)?.city === "Makkah" ? "Madinah" : "Makkah")])}>
        Add stay
      </button>
    )}
    {catalogue && stays.map((stay, index) => {
      const available = catalogue?.filter(hotel => cityAliases[stay.city].includes(normalizeHotelText(hotel.city)));
      const exact = available?.filter(hotel => matchesHotel(hotel, stay));
      const alternatives = exact?.length === 0 ? available?.filter(hotel => matchesHotel(hotel, { ...stay, min: "", max: "" }))
        .filter(hotel => hotel.distanceToHaramM !== null && !!(stay.min || stay.max))
        .sort((a, b) => distanceDifference(a, stay) - distanceDifference(b, stay)).slice(0, 3) : [];
      return <fieldset key={index} className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">Stay {index + 1} · {stay.city}</legend>
        <details className="text-sm">
          <summary className="cursor-pointer py-1 text-brand-800">Refine filters</summary>
          <div className="grid gap-2 py-2 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm">City<select className={field} value={stay.city} onChange={e => update(index, { city: e.target.value === "Madinah" ? "Madinah" : "Makkah", location: "" })}>
              <option>Makkah</option><option>Madinah</option>
            </select></label>
            <label className="text-sm">Area or road<input className={field} value={stay.location} onChange={e => update(index, { location: e.target.value })} /></label>
            <label className="text-sm">Minimum walk (m)<input className={field} type="number" min={0} value={stay.min} onChange={e => update(index, { min: e.target.value })} /></label>
            <label className="text-sm">Maximum walk (m)<input className={field} type="number" min={0} value={stay.max} onChange={e => update(index, { max: e.target.value })} /></label>
          </div>
          {stay.min && stay.max && Number(stay.min) > Number(stay.max) && <p role="alert" className="text-sm text-red-700">Minimum walking distance must be at most the maximum.</p>}
          <div aria-label="Star ratings" role="group" className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 7].map(star => <label key={star} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={stay.stars.includes(star)} onChange={e => update(index, {
                stars: e.target.checked ? [...stay.stars, star] : stay.stars.filter(value => value !== star),
              })} />{star}★</label>)}
            <button type="button" className="ml-auto text-sm underline" disabled={busy} onClick={() => {
              setStays(stays.filter((_, i) => i !== index));
              setSelected({});
            }}>Remove stay {index + 1}</button>
          </div>
        </details>
        {exact && <p className="text-sm" role="status">{exact.length ? exact.length + " catalogue matches" : alternatives?.length ? "No exact matches. Nearby alternatives:" : "No matches. Review the city, area, stars, and distance."}</p>}
        <div className="grid gap-2 sm:grid-cols-2">{(exact?.length ? exact : alternatives)?.map(hotel => {
          const selectedHotel = selected[index]?.id === hotel.id;
          return <div key={hotel.id} className={"space-y-2 rounded-lg border p-3 text-sm " + (selectedHotel ? "border-brand-700 bg-brand-50" : "bg-white")}>
            <h3 className="text-base font-semibold">{hotel.name}</h3>
            <p>{[hotel.area, hotel.road, hotel.starRating && hotel.starRating + "★"].filter(Boolean).join(" · ")}</p>
            {hotel.address && <p className="text-slate-600">{hotel.address}</p>}
            <p>{hotel.distanceToHaramM === null ? "Walking distance unknown" : hotel.distanceToHaramM + " m to " + (hotel.distanceReference ?? "unspecified entrance")}
              {hotel.distanceToHaramM !== null && !hotel.distanceVerifiedOn && " · Unverified"}
              {hotel.shuttleAvailable && " · Shuttle available"}</p>
            {!exact?.length && <p>{distanceDifference(hotel, stay)} m {hotel.distanceToHaramM! < Number(stay.min) ? "below your minimum" : "beyond your maximum"}</p>}
            <p><span className="rounded bg-slate-100 px-2 py-1">Availability on request</span></p>
            {hotel.indicativeNightlySar !== null && <p><strong>SAR {hotel.indicativeNightlySar}</strong> / room / night <span className="text-slate-600">(indicative)</span></p>}
            <button type="button" className={button} aria-pressed={selectedHotel} disabled={busy}
              onClick={() => {
                if (selectedHotel) {
                  update(index, {});
                  return;
                }
                setSelected({ ...selected, [index]: hotel });
                setPrice(index, { checkIn: pricing[index]?.checkIn || pricing[index - 1]?.checkOut || (index === 0 ? travelDate?.slice(0, 10) ?? "" : ""),
                  checkOut: pricing[index]?.checkOut ?? "", guests: pricing[index]?.guests ?? String(travellers ?? ""),
                  rooms: pricing[index]?.rooms ?? "1", capacity: "", rate: currency === "SAR" && hotel.indicativeNightlySar !== null ? String(hotel.indicativeNightlySar) : "" });
              }}>{selectedHotel ? "Selected" : "Select hotel"}</button>
          </div>;
        })}</div>
      </fieldset>;
    })}
    {!!Object.keys(selected).length && <div className="space-y-3 rounded-md border p-3">
      <h3 className="font-semibold">Price shortlisted stays</h3>
      <p className="text-sm text-slate-600">Check room availability and capacity with the supplier. Review the nightly selling rate before adding the stay. For rates that change mid-stay, enter separate quote lines for each rate period.</p>
      <label className="block max-w-36 text-sm">Quote currency<select className={field} value={currency} onChange={event => { setCurrency(event.target.value); setPricing(current => Object.fromEntries(Object.entries(current).map(([index, stay]) => [index, { ...stay, rate: "" }]))); }}>
        {quoteCurrencies.map(code => <option key={code}>{code}</option>)}
      </select></label>
      {Object.entries(selected).map(([key, hotel]) => {
        const index = Number(key);
        const stay = pricing[index];
        const line = hotelQuoteLine(hotel.name, stay);
        return <fieldset className="grid gap-2 rounded border p-2 sm:grid-cols-3" key={key}>
          <legend className="px-1 text-sm font-semibold">Stay {index + 1} · {hotel.name}</legend>
          {([
            ["checkIn", "Check-in", "date"], ["checkOut", "Checkout", "date"], ["guests", "Guests", "number"],
            ["rooms", "Rooms", "number"], ["capacity", "Guests allowed per room", "number"], ["rate", "Selling rate per room per night", "number"],
          ] as const).map(([name, label, type]) =>
            <label key={name} className="text-sm">{label}
              <input className={field} type={type} min={type === "number" ? (name === "rate" ? "0.01" : "1") : undefined}
                step={name === "rate" ? "0.01" : undefined} value={stay[name]} onChange={event => setPrice(index, { [name]: event.target.value })} />
            </label>)}
          {line && <p className="text-sm sm:col-span-3">Stay total <strong>{currency} {(line.unitMinor * line.quantity / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></p>}
        </fieldset>;
      })}
      <div className="flex flex-wrap gap-2">
        <button className={button} type="button" disabled={busy} onClick={priceShortlist}>Add priced stays to quote</button>
        <button className={button} type="button" disabled={busy} onClick={() => void save()}>Save shortlist to lead</button>
      </div>
    </div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}

function distanceDifference(hotel: Hotel, stay: HotelStay) {
  const distance = hotel.distanceToHaramM ?? 0;
  return Math.max(0, stay.min ? Number(stay.min) - distance : 0, stay.max ? distance - Number(stay.max) : 0);
}
