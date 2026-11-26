import { randomUUID } from "node:crypto";
import { z } from "zod";

const day = z.string().date();
const airport = z.string().regex(/^[A-Z]{3}$/);
export const flightSearchInput = z.object({
  origin: airport, destination: airport, returnFrom: airport,
  departure: day, returning: day,
  adults: z.number().int().min(1).max(9),
  stops: z.enum(["0", "1", "any"]),
}).strict().refine(input => input.departure >= new Date().toISOString().slice(0, 10)
  && input.returning >= input.departure && input.origin !== input.destination && input.origin !== input.returnFrom,
  "Choose different airports and valid travel dates.");

const segment = z.object({
  origin: z.object({ iata_code: airport }),
  destination: z.object({ iata_code: airport }),
  departing_at: z.string(),
  arriving_at: z.string(),
  marketing_carrier: z.object({ iata_code: z.string() }),
  marketing_carrier_flight_number: z.string(),
  passengers: z.array(z.object({ baggages: z.array(z.object({ type: z.string(), quantity: z.number() })).optional() })).optional(),
});

const offer = z.object({
  id: z.string(), total_amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  total_currency: z.enum(["PKR", "SAR", "USD", "CAD", "GBP", "EUR"]),
  expires_at: z.string().datetime({ offset: true }), owner: z.object({ name: z.string() }),
  slices: z.array(z.object({ segments: z.array(segment).min(1) })).length(2),
});

type Input = z.infer<typeof flightSearchInput>;
type Offer = z.infer<typeof offer>;
type Job = { id: string; owner: string; lead: string; createdAt: number; checkedAt?: string;
  status: "searching" | "complete" | "unavailable"; offers: Offer[] };
const jobs = new Map<string, Job>();
const ttl = 15 * 60_000;

export function flightSearchSettings() {
  return { enabled: process.env.FLIGHT_SEARCH_ENABLED !== "false", live: !!process.env.DUFFEL_ACCESS_TOKEN?.startsWith("duffel_live_") };
}

async function fetchOffers(input: Input, token: string) {
  const abort = AbortSignal.timeout(24_000);
  const response = await fetch("https://api.duffel.com/air/offer_requests?supplier_timeout=15000&return_offers=true", {
    method: "POST", signal: abort,
    headers: { Authorization: "Bearer " + token, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ data: {
      slices: [
        { origin: input.origin, destination: input.destination, departure_date: input.departure },
        { origin: input.returnFrom, destination: input.origin, departure_date: input.returning },
      ],
      passengers: Array.from({ length: input.adults }, () => ({ type: "adult" })),
      cabin_class: "economy",
      ...(input.stops === "any" ? {} : { max_connections: Number(input.stops) }),
    } }),
  });
  if (!response.ok) throw new Error("Fare provider unavailable");
  const data = z.object({ data: z.object({ offers: z.array(z.unknown()) }) }).parse(await response.json());
  return data.data.offers.flatMap(raw => {
    const parsed = offer.safeParse(raw);
    if (!parsed.success) return [];
    const item = parsed.data;
    const matches = item.slices.every(({ segments }, index) =>
      segments[0].origin.iata_code === (index ? input.returnFrom : input.origin)
      && segments[0].departing_at.slice(0, 10) === (index ? input.returning : input.departure)
      && segments.at(-1)?.destination.iata_code === (index ? input.origin : input.destination)
      && (input.stops === "any" || segments.length <= Number(input.stops) + 1));
    return matches && Date.parse(item.expires_at) > Date.now() && Number(item.total_amount) > 0 ? [item] : [];
  }).sort((a, b) => a.total_currency.localeCompare(b.total_currency) || Number(a.total_amount) - Number(b.total_amount)).slice(0, 40);
}

export function startFlightSearch(owner: string, lead: string, input: Input) {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!flightSearchSettings().enabled || !token?.startsWith("duffel_live_")) return;
  for (const [key, job] of jobs) if (Date.now() - job.createdAt >= ttl) jobs.delete(key);
  if (jobs.size >= 100 || [...jobs.values()].some(job => job.owner === owner && job.status === "searching")) return;
  const job: Job = { id: randomUUID(), owner, lead, createdAt: Date.now(), status: "searching", offers: [] };
  jobs.set(job.id, job);
  void fetchOffers(input, token).then(offers => {
    job.offers = offers;
    job.checkedAt = new Date().toISOString();
    job.status = "complete";
  }).catch(() => { job.status = "unavailable"; });
  return job.id;
}

export function flightSearchResult(owner: string, lead: string, id: string) {
  const job = jobs.get(id);
  if (!flightSearchSettings().enabled || !job || job.owner !== owner || job.lead !== lead || Date.now() - job.createdAt >= ttl) return;
  return { status: job.status, checkedAt: job.checkedAt, offers: job.offers.filter(item => Date.parse(item.expires_at) > Date.now()) };
}
