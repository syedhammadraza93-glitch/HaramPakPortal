/**
 * Generated documents. The default titles are generic document names; the admin can change every title, intro and
 * footer (terms) in Settings → Documents. Company name, address, logo and colours always come from Settings.
 */
export const DOCUMENT_TYPES = [
  { type: "quotation", title: "Quotation", label: "Quotation" },
  { type: "proforma_invoice", title: "Pro forma invoice", label: "Pro forma invoice" },
  { type: "sales_invoice", title: "Invoice", label: "Sales invoice" },
  { type: "payment_receipt", title: "Payment receipt", label: "Payment receipt" },
  { type: "credit_note", title: "Credit note", label: "Credit note" },
  { type: "booking_confirmation", title: "Booking confirmation", label: "Booking confirmation" },
  { type: "travel_voucher", title: "Travel voucher", label: "Travel voucher" },
  { type: "passenger_list", title: "Passenger list", label: "Passenger list" },
  { type: "ledger_statement", title: "Statement of account", label: "Ledger statement" },
  { type: "brochure", title: "Package details", label: "Package brochure / itinerary" },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]["type"];
