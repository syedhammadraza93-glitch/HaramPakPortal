import { randomUUID } from "node:crypto";
import { badRequest } from "../utils/http";

export type HotelCity = "Makkah" | "Madinah";

type OnlineHotel = {
  id: string;
  name: string;
  address: string;
  city: HotelCity;
  starRating: number | null;
  sourceUrl: string;
};

type Place = {
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  osm_type?: string;
  osm_id?: number;
  extratags?: { stars?: string };
};

const cache = new Map<string, { expires: number; hotels: OnlineHotel[] }>();
let nextRequest = 0;
let pending = false;

export async function findOnlineHotels(name: string, city: HotelCity) {
  const key = city + ":" + name.normalize("NFKC").toLowerCase();
  const now = Date.now();
  for (const [cacheKey, entry] of cache) {
    if (entry.expires <= now) cache.delete(cacheKey);
  }
  const cached = cache.get(key);
  if (cached) return cached.hotels;
  if (pending || now < nextRequest) throw badRequest("Online lookup is busy. Try again in a moment.");
  if (cache.size >= 1000) throw badRequest("Online lookup capacity reached. Try again later.");
  pending = true;
  nextRequest = now + 1100;
  try {
    const params = new URLSearchParams({
      q: name + ", " + city + ", Saudi Arabia",
      countrycodes: "sa", format: "jsonv2", extratags: "1", limit: "8",
      bounded: "1", viewbox: city === "Makkah" ? "39.67,21.54,40.01,21.28" : "39.44,24.61,39.78,24.30",
    });
    const response = await fetch((process.env.HOTEL_LOOKUP_SEARCH_URL || "https://nominatim.openstreetmap.org/search") + "?" + params, {
      headers: { "User-Agent": "HaramPakPortal/1.0 (https://haram-pak-portal.vercel.app)", "Accept-Language": "en" },
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error("Lookup provider unavailable");
    const places = await response.json() as Place[];
    const hotels = places.flatMap(place => {
      if (place.category !== "tourism" || place.type !== "hotel" || !place.name || !place.display_name
        || !place.osm_type || !["node", "way", "relation"].includes(place.osm_type) || !Number.isSafeInteger(place.osm_id)) return [];
      const stars = Number(place.extratags?.stars);
      return [{
        id: randomUUID(), name: place.name.slice(0, 150), address: place.display_name.slice(0, 500), city,
        starRating: Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null,
        sourceUrl: "https://www.openstreetmap.org/" + place.osm_type + "/" + place.osm_id,
      }];
    });
    cache.set(key, { expires: now + 86_400_000, hotels });
    return hotels;
  } catch {
    throw badRequest("Online lookup is temporarily unavailable. Try again or refine the hotel name.");
  } finally {
    pending = false;
  }
}

export function onlineHotelCandidate(id: string) {
  for (const entry of cache.values()) {
    if (entry.expires <= Date.now()) continue;
    const hotel = entry.hotels.find(candidate => candidate.id === id);
    if (hotel) return hotel;
  }
  throw badRequest("This result expired. Search for the hotel again.");
}
