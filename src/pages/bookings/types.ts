import type { Vertical } from "../../utils/format";

/** Booking as returned by both the agent and the admin API (admin gets a few extra fields). */
export interface BookingDetail {
  id: string;
  reference: string | null;
  agencyId: string;
  packageId: string;
  departureId: string | null;
  vertical: Vertical;
  packageCode: string;
  packageName: string;
  departureDate: string | null;
  returnDate: string | null;
  status: string;
  statusLabel: string;
  isQuotation: boolean;
  requestedDates: string | null;
  agentNotes: string | null;
  agentReference: string | null;
  paxCount: number;
  currency: string;
  subtotal: number;
  chargesTotal: number;
  totalAmount: number;
  quoteValidUntil: string | null;
  seatsHeld: number;
  holdExpiresAt: string | null;
  seatsSold: number;
  submittedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancellationCharge: number | null;
  createdAt: string;
  updatedAt: string;
  agency: { id: string; name: string; agentCode: string | null; email: string; phone: string };
  package: { id: string; code: string; name: string; bookingMode: string; minPax: number; maxGroupSize: number | null; status: string };
  departure: { id: string; departureDate: string; returnDate: string | null; bookingDeadline: string | null; seatsLeft: number | null; status: string } | null;
  passengers: Passenger[];
  addons: { addonId: string; quantity: number; name: string; price: number; basis: string }[];
  priceLines: PriceLine[];
  documents: BookingDocument[];
  history: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; actorType: string; changedByName: string | null; createdAt: string }[];
  messages: { id: string; authorType: string; authorName: string; message: string; isInternal: boolean; createdAt: string }[];
  documentRequirements: { id: string; name: string; description: string | null; isRequired: boolean; appliesTo: string }[];
  stages: { id: string; name: string; description: string | null; done: boolean; completedAt: string | null; completedByName: string | null; note?: string | null }[];
  allowedActions: string[];
  // agent only
  liveQuote?: { lines: PriceLine[]; subtotal: number; chargesTotal: number; total: number; problems: string[] } | null;
  availableAddons?: { id: string; name: string; description: string | null; price: number; basis: string }[];
  // admin only
  actionRules?: Record<string, { label: string; reasonRequired: boolean }>;
  canManage?: boolean;
  /** PDFs available at the booking's current stage (quotation, proforma, invoice, confirmation, voucher, passenger-list). */
  documentsAvailable?: string[];
  invoiceNumber?: string | null;
  /** Admin only, while the booking can still be confirmed: the agency's credit position against this booking. */
  credit?: {
    currency: string;
    balance: number;
    available: number;
    paymentTerms: "advance" | "credit";
    creditPolicy: "warn" | "block";
    check: { amount: number; available: number; shortBy: number; withinCredit: boolean; policy: "warn" | "block" };
    canOverride: boolean;
  } | null;
}

export interface Passenger {
  id: string;
  fullName: string;
  gender: "male" | "female" | null;
  dateOfBirth: string | null;
  nationality: string | null;
  passportNumber: string | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
  paxType: string;
  roomType: string | null;
  phone: string | null;
  notes: string | null;
}

export interface PriceLine {
  kind: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface BookingDocument {
  id: string;
  passengerId: string | null;
  requirementId: string | null;
  name: string;
  issued: boolean;
  fileName: string;
  sizeBytes: number;
  status: string;
  reviewNote: string | null;
  uploadedByType: string;
  createdAt: string;
}
