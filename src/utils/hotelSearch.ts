export type HotelFilters = { location: string; stars: number[]; min: string; max: string; budget?: number; noShuttle?: boolean };
export type HotelMatchFields = {
  indicativeNightlySar?: number | null; shuttleAvailable?: boolean | null;
  area: string | null; road: string | null; locationAliases: string | null;
  starRating: number | null; distanceToHaramM: number | null;
};

export const normalizeHotelText = (value: string) => value.normalize("NFKC").toLowerCase().trim();

export function matchesHotel(hotel: HotelMatchFields, filters: HotelFilters) {
  const location = normalizeHotelText(filters.location);
  return (!filters.budget || (hotel.indicativeNightlySar != null && hotel.indicativeNightlySar <= filters.budget))
    && (!location || [hotel.area, hotel.road, hotel.locationAliases].some(value => value && normalizeHotelText(value).includes(location)))
    && (!filters.stars.length || (hotel.starRating !== null && filters.stars.includes(hotel.starRating)))
    && (!filters.min || (hotel.distanceToHaramM !== null && hotel.distanceToHaramM >= Number(filters.min)))
    && (!filters.max || (hotel.distanceToHaramM !== null && hotel.distanceToHaramM <= Number(filters.max)));
}

const cities = {
  Makkah: /\bmakkah\b|\bmecca\b|مکہ|مكة/g,
  Madinah: /\bmadinah\b|\bmedina\b|\bmadina\b|مدینہ|مدينة/g,
} as const;
type City = keyof typeof cities;
export type HotelStay = HotelFilters & { city: City; requestedHotel?: string; similar?: boolean; candidates?: string[]; nights?: number; rooms?: number; guests?: number; entrance?: string; ramadanDay?: number; checkIn?: string; checkOut?: string; unresolvedHotel?: boolean };
type NamedHotel = { id: string; name: string; city: string; starRating: number | null };

const similarHotel = /\bor similar\b|\b(?:similar to|same standard as|prefer(?:ably)?|or equivalent|ya isi tarah|ya koi)\b|یا اس جیسا|یا اسی طرح|یا کوئی/;
const searchableHotelName = (value: string) => normalizeHotelText(value).normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\bkiswa\b/g, "kiswah")
  .replace(/الکسوہ|کسوہ|الكسوة|الکسوا/g, "kiswah")
  .replace(/\b(?:al|hotel|towers?)\b/g, " ")
  .replace(/\s+/g, " ").trim();

function findNamedHotels(text: string, hotels: NamedHotel[], city?: City) {
  const query = " " + searchableHotelName(text) + " ";
  const scoped = hotels.filter(hotel => !city || normalizeHotelText(hotel.city).match(cities[city]));
  const matches = scoped.flatMap(hotel => {
    const name = searchableHotelName(hotel.name);
    return name.length >= 4 && query.includes(" " + name + " ") ? [{ hotel, length: name.length }] : [];
  }).sort((a, b) => b.length - a.length);
  if (matches.length) return matches.filter(match => match.length === matches[0].length).map(match => match.hotel);
  const brand = query.match(/ (zam[ -]?zam|movenpick|hilton|hyatt|marriott|intercontinental|swissotel) /)?.[1];
  if (!brand) return [];
  return scoped.filter(hotel => (" " + searchableHotelName(hotel.name) + " ").includes(" " + brand + " "));
}

const locations: Record<City, [RegExp, string][]> = {
  Makkah: [
    [/ibrahim\s+(?:al\s+)?khalil|ابراہیم\s+خلیل/, "Ibrahim Khalil Road"],
    [/hijra[h]?\s+(?:road|street)|ہجرہ\s+روڈ/, "Hijra Road"],
    [/jabal\s+omar|جبل\s+عمر/, "Jabal Omar"],
    [/ajyad|اجیاد/, "Ajyad"],
    [/aziziyah|aziziah|عزیزیہ/, "Aziziyah"],
    [/clock\s+tower|کلاک\s+ٹاور/, "Clock Tower"],
  ],
  Madinah: [[/markaz[iy]+a[h]?|central\s+area|مرکزیہ|مركزي/, "Markaziyah"]],
};

function constraints(text: string): HotelFilters {
  const distance = text.match(/(?:\b(\d{1,5}(?:\.\d+)?)\s*(?:–|—|-|to|سے)\s*)?\b(\d{1,5}(?:\.\d+)?)\s*(?:metres?\b|meters?\b|km\b|kilomet(?:re|er)s?\b|m\b|میٹر)/);
  const stars = text.match(/\b([1-7])\s*(?:(?:or|and|to|یا|اور|–|-|\/)\s*([1-7])\s*)?[- ]*(?:stars?\b|سٹار|اسٹار|ستارہ|★)/);
  const factor = distance && /(?:km|kilomet(?:re|er)s?)$/i.test(distance[0]) ? 1000 : 1;
  const budget = text.match(/(?:under|up to|max(?:imum)?|budget(?: of)?|within)\s*(?:sar|riyal)?\s*(\d+(?:\.\d+)?)\s*(?:sar|riyals?)\b|(?:under|up to|max(?:imum)?|budget(?: of)?|within)\s*sar\s*(\d+(?:\.\d+)?)/);
  return {
    budget: budget ? Number(budget[1] ?? budget[2]) : undefined,
    noShuttle: /\b(?:no shuttle|walk(?:ing)? only|without (?:a )?shuttle)\b|بغیر شٹل/.test(text),
    location: "",
    stars: stars ? [...new Set([Number(stars[1]), ...(stars[2] ? [Number(stars[2])] : [])])] : [],
    min: distance?.[1] ? String(Math.round(Number(distance[1]) * factor)) : "",
    max: distance?.[2] ? String(Math.round(Number(distance[2]) * factor)) : "",
  };
}

export const requestsSimilarHotel = (input: string) => similarHotel.test(normalizeHotelText(input));

export function suggestHotelStays(input: string, hotels: NamedHotel[] = []): HotelStay[] {
  const text = normalizeHotelText(input)
    .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15))
    .replace(/تین\s*(?:یا|اور)?\s*چار\s*(سٹار|اسٹار)/g, "3 or 4 stars");
  const mentions = (Object.keys(cities) as City[]).flatMap(city =>
    [...text.matchAll(cities[city])].map(match => ({ city, index: match.index }))).sort((a, b) => a.index - b.index);
  if (!mentions.length) {
    const named = findNamedHotels(text, hotels);
    const possibleCities = (Object.keys(cities) as City[]).filter(candidate => named.some(hotel => normalizeHotelText(hotel.city).match(cities[candidate])));
    if (possibleCities.length > 1) return possibleCities.flatMap(city => suggestHotelStays(city + " " + input, hotels));
    const [city] = possibleCities;
    if (city) return suggestHotelStays(city + " " + input, hotels);
    return [];
  }
  const shared = text.match(/(?:for (?:both|all) (?:cities|stays)|(?:both|all) (?:cities|stays))([^;]*)/)?.[1] ?? "";
  const overall = constraints(shared);
  return mentions.slice(0, 8).map(({ city, index }, i) => {
    const clause = text.slice(i === 0 ? 0 : index, mentions[i + 1]?.index);
    const local = constraints(clause);
    const candidates = findNamedHotels(clause, hotels, city);
    const named = candidates.length === 1 ? candidates[0] : undefined;
    const stars = local.stars.length ? local.stars : overall.stars;
    const similar = requestsSimilarHotel(clause);
    const nights = Number(clause.match(/(\d+)\s*(?:nights?\b|رات)/)?.[1]) || undefined;
    const rooms = Number(text.match(/\b(\d+|one|two|three)\s+rooms?\b/)?.[1]?.replace("one", "1").replace("two", "2").replace("three", "3")) || undefined;
    const guests = Number(text.match(/\b(\d+|five|four|three|two|one)\s*(?:guests?|people|persons?|pax)\b|\brooms? for (\d+|five|four|three|two|one)\b/)?.slice(1).find(Boolean)?.replace("five", "5").replace("four", "4").replace("three", "3").replace("two", "2").replace("one", "1")) || undefined;
    return {
      city,
      requestedHotel: named?.id,
      candidates: candidates.length > 1 ? candidates.map(hotel => hotel.id) : undefined,
      similar,
      unresolvedHotel: !candidates.length && /\b(?:hotel\s+[a-z][a-z-]+|[a-z][a-z-]+\s+hotel)\b/.test(clause.replace(/\b(?:a|any|nearby|star|budget|cheap|similar|good|economy) hotel\b/g, "")),
      checkIn: clause.match(/(?:check[ -]?in|from)\s+(\d{4}-\d{2}-\d{2})/)?.[1],
      checkOut: clause.match(/(?:check[ -]?out|until|to)\s+(\d{4}-\d{2}-\d{2})/)?.[1],
      nights, rooms, guests,
      budget: local.budget ?? overall.budget,
      noShuttle: local.noShuttle || overall.noShuttle,
      entrance: /women['’]?s? (?:entrance|gate)|ladies['’]? (?:entrance|gate)|خواتین.*درواز/.test(clause) ? "Women’s entrance" : undefined,
      ramadanDay: Number(text.match(/(\d{1,2})\s*(?:ramadan|ramzan|رمضان)/)?.[1]) || undefined,
      location: locations[city].find(([pattern]) => pattern.test(clause))?.[1] ?? "",
      min: local.min || overall.min,
      max: local.max || overall.max,
      stars: stars.length || !similar || !named?.starRating ? stars : [named.starRating],
    };
  });
}
