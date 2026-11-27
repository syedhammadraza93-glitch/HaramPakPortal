export type HotelFilters = { location: string; stars: number[]; min: string; max: string };
export type HotelMatchFields = {
  area: string | null; road: string | null; locationAliases: string | null;
  starRating: number | null; distanceToHaramM: number | null;
};

export const normalizeHotelText = (value: string) => value.normalize("NFKC").toLowerCase().trim();

export function matchesHotel(hotel: HotelMatchFields, filters: HotelFilters) {
  const location = normalizeHotelText(filters.location);
  return (!location || [hotel.area, hotel.road, hotel.locationAliases].some(value => value && normalizeHotelText(value).includes(location)))
    && (!filters.stars.length || (hotel.starRating !== null && filters.stars.includes(hotel.starRating)))
    && (!filters.min || (hotel.distanceToHaramM !== null && hotel.distanceToHaramM >= Number(filters.min)))
    && (!filters.max || (hotel.distanceToHaramM !== null && hotel.distanceToHaramM <= Number(filters.max)));
}

const cities = {
  Makkah: /\bmakkah\b|\bmecca\b|مکہ|مكة/g,
  Madinah: /\bmadinah\b|\bmedina\b|\bmadina\b|مدینہ|مدينة/g,
} as const;
type City = keyof typeof cities;
export type HotelStay = HotelFilters & { city: City; requestedHotel?: string; similar?: boolean };
type NamedHotel = { id: string; name: string; city: string; starRating: number | null };

const similarHotel = /\bor similar\b|\bya isi tarah\b|یا اس جیسا|یا اسی طرح/;
const searchableHotelName = (value: string) => normalizeHotelText(value)
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\bkiswa\b/g, "kiswah")
  .replace(/الکسوہ|کسوہ|الكسوة|الکسوا/g, "kiswah")
  .replace(/\b(?:al|hotel|towers?)\b/g, " ")
  .replace(/\s+/g, " ").trim();

function findNamedHotel(text: string, hotels: NamedHotel[], city?: City) {
  const query = " " + searchableHotelName(text) + " ";
  const matches = hotels.flatMap(hotel => {
    if (city && !normalizeHotelText(hotel.city).match(cities[city])) return [];
    const name = searchableHotelName(hotel.name);
    return name.length >= 4 && query.includes(" " + name + " ") ? [{ hotel, length: name.length }] : [];
  }).sort((a, b) => b.length - a.length);
  return matches[0]?.length === matches[1]?.length ? undefined : matches[0]?.hotel;
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
  const distance = text.match(/(?:\b(\d{1,5})\s*(?:–|—|-|to|سے)\s*)?\b(\d{1,5})\s*(?:metres?\b|meters?\b|m\b|میٹر)/);
  const stars = text.match(/\b([1-7])\s*(?:(?:or|and|to|یا|اور|–|-|\/)\s*([1-7])\s*)?[- ]*(?:stars?\b|سٹار|اسٹار|ستارہ|★)/);
  return {
    location: "",
    stars: stars ? [...new Set([Number(stars[1]), ...(stars[2] ? [Number(stars[2])] : [])])] : [],
    min: distance?.[1] ?? "",
    max: distance?.[2] ?? "",
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
    const named = findNamedHotel(text, hotels);
    const city = (Object.keys(cities) as City[]).find(candidate => named && normalizeHotelText(named.city).match(cities[candidate]));
    return city ? suggestHotelStays(city + " " + input, hotels) : [];
  }
  const overall = constraints(text);
  const distanceCount = [...text.matchAll(/\d\s*(?:metres?\b|meters?\b|m\b|میٹر)/g)].length;
  const starsCount = [...text.matchAll(/\d\s*(?:stars?\b|سٹار|اسٹار|ستارہ|★)/g)].length;
  return mentions.slice(0, 8).map(({ city, index }, i) => {
    const clause = text.slice(i === 0 ? 0 : index, mentions[i + 1]?.index);
    const local = constraints(clause);
    const sharedDistance = distanceCount === 1 && !local.max;
    const named = findNamedHotel(clause, hotels, city);
    const stars = local.stars.length || starsCount !== 1 ? local.stars : overall.stars;
    const similar = requestsSimilarHotel(clause);
    return {
      city,
      requestedHotel: named?.id,
      similar,
      location: locations[city].find(([pattern]) => pattern.test(clause))?.[1] ?? "",
      min: sharedDistance ? overall.min : local.min,
      max: sharedDistance ? overall.max : local.max,
      stars: stars.length || !similar || !named?.starRating ? stars : [named.starRating],
    };
  });
}
