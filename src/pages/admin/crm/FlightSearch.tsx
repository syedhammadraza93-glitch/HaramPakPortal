import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../../utils/api";

const carriers = [
  ["PIA", "https://www.piac.com.pk/"], ["Airblue", "https://www.airblue.com/"],
  ["AirSial", "https://www.airsial.com/"], ["Fly Jinnah", "https://www.flyjinnah.com/"],
  ["Saudia", "https://www.saudia.com/"], ["flynas", "https://www.flynas.com/"],
  ["flyadeal", "https://www.flyadeal.com/"],
];
const pakistan = ["LHE", "MUX", "ISB", "KHI", "PEW", "SKT", "LYP", "UET"];
const saudi = ["JED", "MED", "RUH", "DMM", "ELQ"];
const currencies = ["PKR", "SAR", "USD", "CAD", "GBP", "EUR"];
const controls = "w-full rounded-md border bg-white p-2 text-sm";
const action = "rounded-md border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 disabled:opacity-50";

type Segment = {
  origin: { iata_code: string }; destination: { iata_code: string };
  departing_at: string; arriving_at: string;
  marketing_carrier: { iata_code: string }; marketing_carrier_flight_number: string;
  passengers?: { baggages?: { type: string; quantity: number }[] }[];
};
type Offer = {
  id: string; owner: { name: string }; total_amount: string; total_currency: string; expires_at: string;
  slices: { segments: Segment[] }[];
};
type Results = { status: "searching" | "complete" | "unavailable"; checkedAt?: string; offers: Offer[] };
export type FlightQuote = { label: string; total: number; currency: string };

const options = (items: readonly string[]) => items.map(item => <option key={item}>{item}</option>);
const flightNumber = (s: Segment) => s.marketing_carrier.iata_code + s.marketing_carrier_flight_number;
const readableError = (error: unknown) => error instanceof Error ? error.message : "Flight search is unavailable.";

export default function FlightSearch({ path, departure, adults, onAdd }: {
  path: string; departure?: string | null; adults?: number | null; onAdd: (fare: FlightQuote) => boolean;
}) {
  const [settings, setSettings] = useState<{ enabled: boolean; live: boolean }>();
  const [job, setJob] = useState("");
  const [result, setResult] = useState<Results>();
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;
    void api.get<{ enabled: boolean; live: boolean }>(path + "/flights/settings")
      .then(data => { if (active) setSettings(data); })
      .catch(() => { if (active) setSettings({ enabled: true, live: false }); });
    return () => { active = false; };
  }, [path]);

  useEffect(() => {
    if (!job) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await api.get<Results>(path + "/flights/" + job);
        if (!active) return;
        setResult(data);
        if (data.status === "searching") timer = setTimeout(poll, 1500);
        else setJob("");
      } catch (error) {
        if (!active) return;
        setNotice(readableError(error));
        setJob("");
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [job, path]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setNotice("");
    setResult(undefined);
    setStarting(true);
    try {
      const response = await api.post<{ id: string }>(path + "/flights", {
        origin: data.get("origin"), destination: data.get("destination"), returnFrom: data.get("returnFrom") || data.get("destination"),
        departure: data.get("departure"), returning: data.get("returning"), adults: Number(data.get("adults")), stops: data.get("stops"),
      });
      setJob(response.data.id);
    } catch (error) { setNotice(readableError(error)); }
    finally { setStarting(false); }
  }

  function add(fare: FlightQuote) {
    if (onAdd(fare)) setNotice("Flight added to the quote below.");
  }

  if (!settings?.enabled) return null;
  return <section className="space-y-3 rounded-lg border bg-white p-4">
    <h2 className="font-semibold">Flight search</h2>
    {settings.live ? <form onSubmit={search} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label>From<select className={controls} name="origin">{options(pakistan)}</select></label>
        <label>To<select className={controls} name="destination">{options(saudi)}</select></label>
        <label>Return from<select className={controls} name="returnFrom"><option value="">Same as destination</option>{options(saudi)}</select></label>
        <label>Departure<input className={controls} type="date" name="departure" required defaultValue={departure?.slice(0, 10)} /></label>
        <label>Return<input className={controls} type="date" name="returning" required /></label>
        <label>Adults<input className={controls} type="number" name="adults" min={1} max={9} required defaultValue={adults && adults <= 9 ? adults : 1} /></label>
        <label>Stops<select className={controls} name="stops"><option value="0">Nonstop only</option><option value="1">Up to 1 stop</option><option value="any">Any</option></select></label>
      </div>
      <button className={action} disabled={starting || !!job}>{starting || job ? "Checking fares…" : "Search economy fares"}</button>
    </form> : <p className="text-sm text-slate-600">Live fare lookup is awaiting provider setup. Check an airline below and add the verified total manually.</p>}
    {result?.status === "complete" && <p className="text-sm text-slate-600">{result.offers.length
      ? "Results from connected carriers, sorted by total price within each currency. Checked " + new Date(result.checkedAt ?? "").toLocaleString()
      : "No matching fares returned by the connected provider. Use an airline website to check other fares."}</p>}
    {result?.status === "unavailable" && <p role="status" className="text-sm text-red-700">The provider couldn’t complete the lookup. Check the airline website or try again.</p>}
    <ul className="space-y-2">{result?.offers.map(offer => {
      const numbers = offer.slices.map(slice => slice.segments.map(flightNumber).join(" / ")).join(" · ");
      return <li key={offer.id} className="space-y-2 rounded border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{offer.owner.name}</strong><strong>{offer.total_currency} {offer.total_amount} total</strong></div>
        {offer.slices.map(({ segments }, i) => <div key={i}>
          <div>{i === 0 ? "Outbound" : "Return"} · {segments.length === 1 ? "Nonstop" : (segments.length - 1) + " stop(s)"}</div>
          {segments.map((s, j) => <div key={j}>{flightNumber(s)} · {s.origin.iata_code} {s.departing_at.replace("T", " ")} → {s.destination.iata_code} {s.arriving_at.replace("T", " ")} · Checked bags by passenger: {s.passengers?.map(p => p.baggages?.find(b => b.type === "checked")?.quantity ?? "unknown").join(", ") || "unknown"}</div>)}
        </div>)}
        <p>Offer expires {new Date(offer.expires_at).toLocaleString()}. Recheck before booking.</p>
        <button type="button" className={action} onClick={() => {
          if (Date.parse(offer.expires_at) <= Date.now()) return setNotice("This offer expired. Search again before adding it to the quote.");
          add({ label: (offer.owner.name + " round trip · " + numbers).slice(0, 180), total: Number(offer.total_amount), currency: offer.total_currency });
        }}>Add fare to quote</button>
      </li>;
    })}</ul>
    <details open={!settings.live}>
      <summary className="cursor-pointer text-sm font-semibold">Check airline sites or enter a fare manually</summary>
      <ul className="my-2 flex flex-wrap gap-3 text-sm">{carriers.map(([name, url]) =>
        <li key={name}><a className="underline" href={url} target="_blank" rel="noreferrer">{name}</a></li>)}</ul>
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        add({ label: String(data.get("label")).trim(), total: Number(data.get("total")), currency: String(data.get("currency")) });
      }}>
        <label>Airline and flight details<input className={controls} name="label" required minLength={2} maxLength={180} /></label>
        <label>Total for all passengers<input className={controls} name="total" type="number" min="0.01" max="10000000" step="0.01" required /></label>
        <label>Currency<select className={controls} name="currency">{options(currencies)}</select></label>
        <button className={action}>Add manual fare to quote</button>
      </form>
    </details>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
