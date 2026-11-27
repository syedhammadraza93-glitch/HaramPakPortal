export const quoteCurrencies = ["PKR", "SAR", "USD", "CAD", "GBP", "EUR"];
export type DraftLine = { label: string; quantity: number; unitMinor: number };
export type StayPricing = { checkIn: string; checkOut: string; guests: string; rooms: string; capacity: string; rate: string };

export function hotelQuoteLine(hotel: string, stay: StayPricing): DraftLine | undefined {
  const nights = (Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000;
  const guests = Number(stay.guests);
  const rooms = Number(stay.rooms);
  const capacity = Number(stay.capacity);
  const quantity = nights * rooms;
  const unitMinor = Math.round(Number(stay.rate) * 100);
  if (![nights, guests, rooms, capacity, quantity, unitMinor].every(Number.isSafeInteger)
    || nights < 1 || guests < 1 || rooms < 1 || capacity < 1 || guests > rooms * capacity
    || quantity > 1000 || unitMinor < 1 || unitMinor > 1_000_000_000) return;
  const suffix = ` · ${stay.checkIn} to ${stay.checkOut} · ${nights} nights × ${rooms} room(s)`;
  return { label: hotel.slice(0, 180 - suffix.length) + suffix, quantity, unitMinor };
}
