import type { Vertical } from "../../../utils/format";

export interface Departure {
  id: string;
  departureDate: string;
  returnDate: string | null;
  bookingDeadline: string | null;
  capacity: number | null;
  seatsHeld: number;
  seatsSold: number;
  status: "open" | "closed" | "cancelled";
  notes: string | null;
}

export interface Rate {
  id?: string;
  departureId: string | null;
  roomType: string;
  paxType: string;
  basePrice: number | string;
  retailPrice: number | string | null;
  isActive: boolean;
}

export interface Addon {
  id?: string;
  name: string;
  description: string | null;
  price: number | string;
  basis: "per_person" | "per_booking";
  isActive: boolean;
}

export interface PackageDetail {
  id: string;
  code: string;
  vertical: Vertical;
  name: string;
  category: string | null;
  status: "draft" | "published" | "unpublished" | "archived";
  bookingMode: "fixed_departure" | "on_request";
  summary: string | null;
  description: string | null;
  durationDays: number | null;
  durationNights: number | null;
  destinationId: string | null;
  seasonYear: number | null;
  visaIncluded: boolean;
  airTicketIncluded: boolean;
  transportIncluded: boolean;
  ziyaratIncluded: boolean;
  mealPlan: string | null;
  hotelCategory: string | null;
  minPax: number;
  maxGroupSize: number | null;
  inclusions: string[];
  exclusions: string[];
  customFields: Record<string, string>;
  cancellationPolicyId: string | null;
  currency: string;
  brochureName: string | null;
  hasBrochure: boolean;
  publishedAt: string | null;
  updatedAt: string;
  hotels: { id: string; hotelId: string; name: string; city: string; country: string; starRating: number | null; distanceToHaramM: number | null; nights: number; notes: string | null }[];
  itinerary: { id: string; dayNumber: number; title: string; description: string | null; city: string | null }[];
  departures: Departure[];
  rates: (Rate & { id: string })[];
  addons: (Addon & { id: string })[];
  images: { id: string; fileName: string; url: string; isCover: boolean }[];
  documentRequirements: { id: string; name: string; isRequired: boolean; packageId: string | null }[];
  cancellationPolicy: { id: string; name: string; slabs: { daysBefore: number; chargeType: string; chargeValue: number }[] } | null;
  agencySpecialPrices: number;
  publishProblems: string[];
}

/** Props every editor tab receives. */
export interface TabProps {
  pkg: PackageDetail;
  /** Called with the updated package after a save. */
  onSaved: (pkg: PackageDetail) => void;
  readOnly: boolean;
}
