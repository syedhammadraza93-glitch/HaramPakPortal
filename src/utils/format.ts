import type { AgencyStatus } from "./api";

const TZ = "Asia/Karachi";

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const secs = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const AGENCY_STATUS: Record<AgencyStatus, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  pending_email_verification: { label: "Email not verified", tone: "slate" },
  pending_approval: { label: "Pending approval", tone: "amber" },
  information_required: { label: "Information required", tone: "blue" },
  active: { label: "Active", tone: "green" },
  suspended: { label: "Suspended", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
  deactivated: { label: "Deactivated", tone: "slate" },
};

export const DOC_TYPES: Record<string, string> = {
  cnic_copy: "CNIC copy",
  licence: "Travel agency licence",
  registration_cert: "Business registration certificate",
  other: "Other document",
};

export const ACTION_LABELS: Record<string, { label: string; tone: "primary" | "danger" | "secondary" }> = {
  approve: { label: "Approve", tone: "primary" },
  "request-info": { label: "Request information", tone: "secondary" },
  reject: { label: "Reject", tone: "danger" },
  suspend: { label: "Suspend", tone: "danger" },
  reactivate: { label: "Reactivate", tone: "primary" },
  deactivate: { label: "Deactivate", tone: "danger" },
  reopen: { label: "Reopen application", tone: "secondary" },
};

/** Pretty user agent for the sessions list. */
export function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

// ---------- Catalogue (Phase 2) ----------

export type Vertical = "umrah" | "hajj" | "tourism";
export const VERTICALS: Record<Vertical, string> = { umrah: "Umrah", hajj: "Hajj", tourism: "International Tourism" };

export const PACKAGE_STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  draft: { label: "Draft", tone: "slate" },
  published: { label: "Published", tone: "green" },
  unpublished: { label: "Unpublished", tone: "amber" },
  archived: { label: "Archived", tone: "red" },
};

export const ROOM_TYPES: Record<string, string> = { sharing: "Sharing", quad: "Quad", triple: "Triple", double: "Double", single: "Single" };
export const PAX_TYPES: Record<string, string> = { adult: "Adult", child_with_bed: "Child with bed", child_no_bed: "Child without bed", infant: "Infant" };
export const BOOKING_MODES: Record<string, string> = { fixed_departure: "Fixed departure dates", on_request: "On request (agent asks for dates)" };

/** Whole-number money with the currency code, e.g. "PKR 250,000". */
export function formatMoney(amount: number | string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  return `${currency} ${Math.round(Number(amount)).toLocaleString("en-US")}`;
}

// ---------- Bookings (Phase 3) ----------

export const BOOKING_STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  draft: { label: "Draft", tone: "slate" },
  submitted: { label: "Submitted", tone: "amber" },
  under_review: { label: "Under review", tone: "blue" },
  information_required: { label: "Information required", tone: "red" },
  quotation_sent: { label: "Quotation sent", tone: "blue" },
  awaiting_payment: { label: "Awaiting payment", tone: "amber" },
  payment_pending_verification: { label: "Payment pending verification", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  processing: { label: "Processing", tone: "green" },
  documents_issued: { label: "Documents issued", tone: "green" },
  completed: { label: "Completed", tone: "slate" },
  cancelled: { label: "Cancelled", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
  refunded: { label: "Refunded", tone: "slate" },
};

export const DOC_REVIEW: Record<string, { label: string; tone: "green" | "amber" | "red" }> = {
  pending: { label: "Waiting for check", tone: "amber" },
  verified: { label: "Verified", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};
