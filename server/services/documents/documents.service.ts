import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "../../database/connection";
import {
  agencies, bookingPassengers, bookings, destinations, financeRequests, hotels, journalEntries, ledgerAccounts, packageDepartures, packageHotels, packageImages,
  packageItinerary, packageRates, packages, payments, type Booking,
} from "../../database/schema";
import type { DocumentType } from "../../utils/documentTypes";
import { notFound } from "../../utils/http";
import { GENDER_LABEL, PAX_LABEL, ROOM_LABEL, VERTICAL_LABEL } from "../../utils/labels";
import { BOOKING_STATUS_LABEL, loadBookingDetail } from "../booking.service";
import { agencyStatement, ledgerCurrency } from "../ledger.service";
import { PAYMENT_METHOD_LABEL } from "../payment.service";
import { htmlToPdf } from "../pdf.service";
import { pricerForAgency } from "../pricing.service";
import { todayInCompanyTz } from "../settings.service";
import { readStoredFile } from "../storage.service";
import { amountInWords, docContext, esc, fmtDate, money, multiline, renderDocument, section, table, type Block, type DocContext } from "./layout";

export interface GeneratedDocument {
  fileName: string;
  pdf: Buffer;
}

async function toPdf(ctx: DocContext, html: string, fileName: string, number?: string | null, landscape = false): Promise<GeneratedDocument> {
  const pdf = await htmlToPdf(html, { landscape, footerNote: [ctx.company.name, ctx.title, number].filter(Boolean).join(" · ") });
  return { fileName: fileName.replace(/[^\w.\-]+/g, "_"), pdf };
}

// ================================================================================
// Booking documents
// ================================================================================
export const BOOKING_DOCS = {
  quotation: "quotation",
  proforma: "proforma_invoice",
  invoice: "sales_invoice",
  confirmation: "booking_confirmation",
  voucher: "travel_voucher",
  "passenger-list": "passenger_list",
} as const satisfies Record<string, DocumentType>;
export type BookingDocSlug = keyof typeof BOOKING_DOCS;

const CONFIRMED: Booking["status"][] = ["confirmed", "processing", "documents_issued", "completed"];
const BEFORE_CONFIRM: Booking["status"][] = ["submitted", "under_review", "information_required", "awaiting_payment", "payment_pending_verification"];

/** Which documents a booking has at its current stage. */
export function availableBookingDocs(b: Pick<Booking, "status" | "isQuotation" | "invoiceNumber" | "totalAmount" | "paxCount">, hasQuotationLines: boolean): BookingDocSlug[] {
  const docs: BookingDocSlug[] = [];
  if (b.status === "draft") return docs;
  if (b.isQuotation && hasQuotationLines) docs.push("quotation");
  if (BEFORE_CONFIRM.includes(b.status) && Number(b.totalAmount) > 0 && (!b.isQuotation || hasQuotationLines)) docs.push("proforma");
  if (b.invoiceNumber) docs.push("invoice");
  if (CONFIRMED.includes(b.status)) docs.push("confirmation", "voucher");
  if (b.paxCount > 0) docs.push("passenger-list");
  return docs;
}

type Detail = Awaited<ReturnType<typeof loadBookingDetail>>;

async function packageExtras(packageId: string) {
  const [[pkg], hotelRows, itinerary] = await Promise.all([
    db.select({ p: packages, city: destinations.city, country: destinations.country }).from(packages).leftJoin(destinations, eq(destinations.id, packages.destinationId)).where(eq(packages.id, packageId)).limit(1),
    db
      .select({ name: hotels.name, stars: hotels.starRating, distance: hotels.distanceToHaramM, address: hotels.address, city: destinations.city, nights: packageHotels.nights, notes: packageHotels.notes })
      .from(packageHotels)
      .innerJoin(hotels, eq(hotels.id, packageHotels.hotelId))
      .innerJoin(destinations, eq(destinations.id, hotels.destinationId))
      .where(eq(packageHotels.packageId, packageId))
      .orderBy(asc(packageHotels.sortOrder)),
    db.select().from(packageItinerary).where(eq(packageItinerary.packageId, packageId)).orderBy(asc(packageItinerary.dayNumber)),
  ]);
  if (!pkg) throw notFound("Package not found");
  return { pkg: pkg.p, destination: pkg.city ? `${pkg.city}, ${pkg.country}` : null, hotels: hotelRows, itinerary };
}

const hotelsTable = (rows: Awaited<ReturnType<typeof packageExtras>>["hotels"]) =>
  table(
    [{ label: "Hotel" }, { label: "City" }, { label: "Nights", align: "center" }, { label: "Category / distance" }],
    rows.map((h) => [
      `${esc(h.name)}${h.notes ? `<div class="small muted">${esc(h.notes)}</div>` : ""}`,
      esc(h.city),
      String(h.nights),
      esc([h.stars ? `${h.stars}★` : null, h.distance !== null && h.distance !== undefined ? `${h.distance} m from Haram` : null].filter(Boolean).join(" · ")),
    ]),
  );

const itineraryHtml = (rows: Awaited<ReturnType<typeof packageExtras>>["itinerary"]) =>
  rows.length ? table([{ label: "Day", width: "50px" }, { label: "Programme" }], rows.map((d) => [`Day ${d.dayNumber}`, `<b>${esc(d.title)}</b>${d.city ? ` <span class="muted">(${esc(d.city)})</span>` : ""}${d.description ? `<div>${multiline(d.description)}</div>` : ""}`])) : "";

function passengersTable(d: Detail, withPassport: boolean) {
  const head = withPassport
    ? [{ label: "#", width: "22px" }, { label: "Name" }, { label: "Gender" }, { label: "Date of birth" }, { label: "Nationality" }, { label: "Passport" }, { label: "Issued" }, { label: "Expires" }, { label: "Type" }, { label: "Room" }]
    : [{ label: "#", width: "22px" }, { label: "Name" }, { label: "Passport" }, { label: "Type" }, { label: "Room" }];
  return table(
    head,
    d.passengers.map((p, i) =>
      withPassport
        ? [String(i + 1), esc(p.fullName), esc(GENDER_LABEL[p.gender ?? ""] ?? p.gender ?? ""), esc(fmtDate(p.dateOfBirth)), esc(p.nationality), esc(p.passportNumber), esc(fmtDate(p.passportIssueDate)), esc(fmtDate(p.passportExpiryDate)), esc(PAX_LABEL[p.paxType] ?? p.paxType), esc(p.roomType ? ROOM_LABEL[p.roomType] ?? p.roomType : "")]
        : [String(i + 1), esc(p.fullName), esc(p.passportNumber), esc(PAX_LABEL[p.paxType] ?? p.paxType), esc(p.roomType ? ROOM_LABEL[p.roomType] ?? p.roomType : "")],
    ),
  );
}

function priceTable(d: Detail) {
  const lines = d.priceLines.length ? d.priceLines : [];
  return table(
    [{ label: "Description" }, { label: "Qty", align: "center", width: "45px" }, { label: "Rate", align: "right", width: "110px" }, { label: "Amount", align: "right", width: "120px" }],
    lines.map((l) => [esc(l.description), String(l.quantity), esc(money(l.unitAmount, d.currency)), esc(money(l.amount, d.currency))]),
    [
      ...(Number(d.chargesTotal) ? [["", "", "Subtotal", esc(money(d.subtotal, d.currency))], ["", "", "Taxes & charges", esc(money(d.chargesTotal, d.currency))]] : []),
      ["", "", "Total", esc(money(d.totalAmount, d.currency))],
    ],
  );
}

function agencyBlock(d: Detail, title = "Agency"): Block {
  return { title, rows: [["Agency", d.agency.name], ["Agent code", d.agency.agentCode], ["Phone", d.agency.phone], ["Email", d.agency.email]] };
}

function tripBlock(d: Detail, extra: Awaited<ReturnType<typeof packageExtras>>): Block {
  return {
    title: "Trip",
    rows: [
      ["Package", `${d.packageName} (${d.packageCode})`],
      ["Product", VERTICAL_LABEL[d.vertical]],
      ["Destination", extra.destination],
      ["Travel", d.isQuotation && !d.departureDate ? d.requestedDates : `${fmtDate(d.departureDate)} – ${fmtDate(d.returnDate)}`],
      ["Duration", extra.pkg.durationDays ? `${extra.pkg.durationDays} days${extra.pkg.durationNights ? ` / ${extra.pkg.durationNights} nights` : ""}` : null],
      ["Passengers", String(d.paxCount)],
      ["Your reference", d.agentReference],
    ],
  };
}

async function activeBanks() {
  return db.select({ name: ledgerAccounts.name, details: ledgerAccounts.bankDetails }).from(ledgerAccounts).where(and(eq(ledgerAccounts.isBank, true), eq(ledgerAccounts.isActive, true))).orderBy(asc(ledgerAccounts.code));
}
const banksHtml = (banks: Awaited<ReturnType<typeof activeBanks>>, reference: string) =>
  banks.length ? section("Payment details", `${banks.map((b) => `<div class="note"><b>${esc(b.name)}</b>${b.details ? `<br>${multiline(b.details)}` : ""}</div>`).join("")}<p class="small muted">Please quote ${esc(reference)} as the payment reference and submit the receipt in the portal.</p>`) : "";

/** Generates one booking document. `agencyId` restricts it to that agency (agent portal). */
export async function bookingDocument(bookingId: string, slug: BookingDocSlug, agencyId?: string): Promise<GeneratedDocument> {
  const d = await loadBookingDetail(bookingId, true);
  if (agencyId && d.agencyId !== agencyId) throw notFound("Booking not found");
  const hasQuote = d.priceLines.some((l) => l.kind === "quotation");
  if (!availableBookingDocs(d, hasQuote).includes(slug)) throw notFound("This document is not available for the booking at its current stage");
  const type = BOOKING_DOCS[slug];
  const ctx = await docContext(type);
  const extra = await packageExtras(d.packageId);
  const ref = d.reference ?? "";
  let number: string | null = ref;
  let body = "";
  let afterBody = "";
  const headerLines: string[] = [];
  let date: string | Date | null = new Date();

  if (slug === "quotation") {
    if (d.quoteValidUntil) headerLines.push(`Valid until ${fmtDate(d.quoteValidUntil)}`);
    headerLines.push(`Booking ${ref}`);
    number = `${ref}-Q`;
    body = section("Quotation", priceTable(d)) + `<div class="words">${esc(amountInWords(Number(d.totalAmount), d.currency))}</div>` + section("Hotels", hotelsTable(extra.hotels));
  } else if (slug === "proforma") {
    number = `${ref}-PF`;
    headerLines.push(`Booking ${ref}`, `Status: ${BOOKING_STATUS_LABEL[d.status]}`);
    body = section("Charges", priceTable(d)) + `<div class="total"><div>Amount payable ${esc(money(d.totalAmount, d.currency))}</div></div><div class="words">${esc(amountInWords(Number(d.totalAmount), d.currency))}</div>`;
    afterBody = banksHtml(await activeBanks(), ref) + `<p class="small muted">This is a pro forma invoice, not a tax invoice. The final invoice is issued when the booking is confirmed.</p>`;
  } else if (slug === "invoice") {
    number = d.invoiceNumber;
    date = d.invoicedAt ?? d.confirmedAt;
    headerLines.push(`Booking ${ref}`);
    const paid = await db
      .select({ reference: payments.reference, amount: payments.amount, paidOn: payments.paidOn })
      .from(payments)
      .where(and(eq(payments.bookingId, d.id), eq(payments.status, "verified")));
    const paidTotal = paid.reduce((s, p) => s + Number(p.amount), 0);
    body =
      section("Charges", priceTable(d)) +
      `<div class="total"><div>Invoice total ${esc(money(d.totalAmount, d.currency))}</div></div><div class="words">${esc(amountInWords(Number(d.totalAmount), d.currency))}</div>` +
      (paid.length
        ? section("Payments received for this booking", table([{ label: "Receipt" }, { label: "Date" }, { label: "Amount", align: "right" }], paid.map((p) => [esc(p.reference), esc(fmtDate(p.paidOn)), esc(money(p.amount, d.currency))]), [["", "Balance on this invoice", esc(money(Math.max(0, Number(d.totalAmount) - paidTotal), d.currency))]]))
        : "");
    afterBody = `<p class="small muted">This invoice has been charged to your account. Payments made on account are shown on your statement.</p>`;
  } else if (slug === "confirmation") {
    headerLines.push(`Confirmed ${fmtDate(d.confirmedAt)}`, `Status: ${BOOKING_STATUS_LABEL[d.status]}`);
    body = section("Passengers", passengersTable(d, false)) + section("Hotels", hotelsTable(extra.hotels)) + section("Price", priceTable(d));
  } else if (slug === "voucher") {
    date = d.departureDate ?? new Date();
    headerLines.push(`Booking ${ref}`);
    const incl = (extra.pkg.inclusions ?? []).length ? section("Included", `<ul class="plain">${extra.pkg.inclusions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`) : "";
    body =
      section("Passengers", passengersTable(d, false)) +
      section("Accommodation", hotelsTable(extra.hotels)) +
      (extra.itinerary.length ? section("Itinerary", itineraryHtml(extra.itinerary)) : "") +
      incl +
      section("Emergency contact", `<p>${esc(ctx.company.name)}${ctx.company.phone ? ` · ${esc(ctx.company.phone)}` : ""}${ctx.company.email ? ` · ${esc(ctx.company.email)}` : ""}</p>`);
  } else {
    number = `${ref}-PL`;
    date = new Date();
    body = section("Passengers", passengersTable(d, true));
  }

  const blocks: Block[] = slug === "passenger-list" ? [agencyBlock(d), tripBlock(d, extra)] : [agencyBlock(d, slug === "voucher" ? "Booked by" : "Bill to"), tripBlock(d, extra)];
  const html = renderDocument(ctx, { number, date, headerLines, blocks, body, afterBody });
  return toPdf(ctx, html, `${ctx.title} ${number ?? ref}.pdf`, number, slug === "passenger-list");
}

// ================================================================================
// Payment receipt and credit note
// ================================================================================
export async function paymentReceipt(paymentId: string, agencyId?: string): Promise<GeneratedDocument> {
  const [row] = await db
    .select({ p: payments, agencyName: agencies.agencyName, agentCode: agencies.agentCode, agencyEmail: agencies.email, bank: ledgerAccounts.name, bookingRef: bookings.reference, entryNumber: journalEntries.entryNumber })
    .from(payments)
    .innerJoin(agencies, eq(agencies.id, payments.agencyId))
    .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, payments.bankAccountId))
    .leftJoin(bookings, eq(bookings.id, payments.bookingId))
    .leftJoin(journalEntries, eq(journalEntries.id, payments.journalEntryId))
    .where(and(eq(payments.id, paymentId), agencyId ? eq(payments.agencyId, agencyId) : undefined))
    .limit(1);
  if (!row) throw notFound("Payment not found");
  if (row.p.status !== "verified" && row.p.status !== "reversed") throw notFound("A receipt is available once the payment is verified");
  const p = row.p;
  const ctx = await docContext("payment_receipt");
  const body =
    `<div class="total"><div>Received ${esc(money(p.amount, p.currency))}</div></div><div class="words">${esc(amountInWords(Number(p.amount), p.currency))}</div>` +
    (p.status === "reversed" ? `<div class="note"><b>This payment was later reversed.</b> ${esc(p.reviewNote ?? "")}</div>` : "");
  const html = renderDocument(ctx, {
    number: p.reference,
    date: p.reviewedAt ?? p.paidOn,
    blocks: [
      { title: "Received from", rows: [["Agency", row.agencyName], ["Agent code", row.agentCode], ["Email", row.agencyEmail]] },
      { title: "Payment", rows: [["Method", PAYMENT_METHOD_LABEL[p.method]], ["Paid on", fmtDate(p.paidOn)], ["Into", row.bank], ["Transaction no.", p.transactionRef], ["For", row.bookingRef ? `Booking ${row.bookingRef}` : "On account"], ["Ledger entry", row.entryNumber]] },
    ],
    body,
  });
  return toPdf(ctx, html, `${ctx.title} ${p.reference}.pdf`, p.reference);
}

/** The document behind a statement line: receipt for a payment, credit note for a credit, invoice for a booking charge. */
export async function entryDocument(entryId: string, agencyId?: string): Promise<GeneratedDocument> {
  const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), agencyId ? eq(journalEntries.agencyId, agencyId) : undefined)).limit(1);
  if (!e) throw notFound("Entry not found");
  if (e.type === "payment" && e.paymentId) return paymentReceipt(e.paymentId, agencyId);
  if (e.type === "booking_charge" && e.bookingId) return bookingDocument(e.bookingId, "invoice", agencyId);
  if ((e.type === "credit_note" || e.type === "credit_adjustment") && e.requestId) return creditNote(e.requestId, agencyId);
  throw notFound("There is no printable document for this entry");
}

export async function creditNote(requestId: string, agencyId?: string): Promise<GeneratedDocument> {
  const [row] = await db
    .select({ r: financeRequests, agencyName: agencies.agencyName, agentCode: agencies.agentCode, agencyEmail: agencies.email, bookingRef: bookings.reference, entryNumber: journalEntries.entryNumber, entryDate: journalEntries.entryDate, description: journalEntries.description })
    .from(financeRequests)
    .innerJoin(agencies, eq(agencies.id, financeRequests.agencyId))
    .leftJoin(bookings, eq(bookings.id, financeRequests.bookingId))
    .leftJoin(journalEntries, eq(journalEntries.id, financeRequests.journalEntryId))
    .where(and(eq(financeRequests.id, requestId), inArray(financeRequests.kind, ["credit_note", "credit_adjustment"]), eq(financeRequests.status, "approved"), agencyId ? eq(financeRequests.agencyId, agencyId) : undefined))
    .limit(1);
  if (!row || !row.entryNumber) throw notFound("Credit note not found");
  const currency = await ledgerCurrency();
  const ctx = await docContext("credit_note");
  const html = renderDocument(ctx, {
    number: row.entryNumber,
    date: row.entryDate,
    blocks: [
      { title: "Credited to", rows: [["Agency", row.agencyName], ["Agent code", row.agentCode], ["Email", row.agencyEmail]] },
      { title: "Details", rows: [["Booking", row.bookingRef], ["Request", row.r.reference]] },
    ],
    body:
      section("Credit", table([{ label: "Description" }, { label: "Amount", align: "right", width: "140px" }], [[esc(row.description ?? ""), esc(money(row.r.amount, currency))]])) +
      `<div class="total"><div>Credited ${esc(money(row.r.amount, currency))}</div></div><div class="words">${esc(amountInWords(Number(row.r.amount), currency))}</div>` +
      `<p class="small muted">This amount has been credited to your account and is shown on your statement.</p>`,
  });
  return toPdf(ctx, html, `${ctx.title} ${row.entryNumber}.pdf`, row.entryNumber);
}

// ================================================================================
// Statement
// ================================================================================
export async function statementPdf(agencyId: string, from: string, to: string): Promise<GeneratedDocument> {
  const [a] = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  if (!a) throw notFound("Agency not found");
  const s = await agencyStatement(agencyId, from, to);
  const ctx = await docContext("ledger_statement");
  const bal = (n: number) => (n === 0 ? money(0, s.currency) : n > 0 ? `${money(n, s.currency)} Dr` : `${money(-n, s.currency)} Cr`);
  const rows = [
    [esc(fmtDate(from)), "", "<b>Balance brought forward</b>", "", "", esc(bal(s.openingBalance))],
    ...s.lines.map((l) => [esc(fmtDate(l.entryDate)), `<span class="small">${esc(l.entryNumber)}</span><div class="small muted">${esc(l.typeLabel)}</div>`, esc(l.description), l.debit ? esc(money(l.debit, s.currency)) : "", l.credit ? esc(money(l.credit, s.currency)) : "", esc(bal(l.balance))]),
  ];
  const html = renderDocument(ctx, {
    number: `${a.agentCode ?? ""} ${from} – ${to}`.trim(),
    date: new Date(),
    headerLines: [`Period ${fmtDate(from)} to ${fmtDate(to)}`],
    blocks: [
      { title: "Account", rows: [["Agency", a.agencyName], ["Agent code", a.agentCode], ["Email", a.email], ["Terms", a.paymentTerms === "credit" ? `Credit, limit ${money(a.creditLimit, s.currency)}${a.paymentTermsDays ? `, ${a.paymentTermsDays} days` : ""}` : "Advance payment"]] },
      { title: "Summary", rows: [["Opening balance", bal(s.openingBalance)], ["Debits", money(s.totalDebit, s.currency)], ["Credits", money(s.totalCredit, s.currency)], ["Closing balance", bal(s.closingBalance)]] },
    ],
    body: table(
      [{ label: "Date", width: "70px" }, { label: "Entry", width: "95px" }, { label: "Details" }, { label: "Debit", align: "right", width: "90px" }, { label: "Credit", align: "right", width: "90px" }, { label: "Balance", align: "right", width: "100px" }],
      rows,
      [["", "", "Totals and closing balance", esc(money(s.totalDebit, s.currency)), esc(money(s.totalCredit, s.currency)), esc(bal(s.closingBalance))]],
    ) + `<p class="small muted">Dr = amount due to us · Cr = credit in your favour.</p>`,
  });
  return toPdf(ctx, html, `${ctx.title} ${a.agentCode ?? a.agencyName} ${from} to ${to}.pdf`, a.agentCode);
}

// ================================================================================
// Package brochure / itinerary
// ================================================================================
export async function brochure(packageId: string, opts: { agencyId?: string; withPrices?: boolean; publishedOnly?: boolean }): Promise<GeneratedDocument> {
  const extra = await packageExtras(packageId);
  const pkg = extra.pkg;
  if (opts.publishedOnly && pkg.status !== "published") throw notFound("This package is not available");
  const ctx = await docContext("brochure");
  const [cover] = await db.select().from(packageImages).where(eq(packageImages.packageId, packageId)).orderBy(asc(packageImages.sortOrder), asc(packageImages.createdAt)).limit(1);
  let coverHtml = "";
  if (cover) {
    try {
      coverHtml = `<img class="cover" src="data:${cover.mimeType};base64,${(await readStoredFile(cover.storageKey)).toString("base64")}" alt="">`;
    } catch {
      coverHtml = "";
    }
  }

  let pricesHtml = "";
  if (opts.withPrices && opts.agencyId) {
    const today = await todayInCompanyTz();
    const [deps, rates] = await Promise.all([
      db.select().from(packageDepartures).where(and(eq(packageDepartures.packageId, packageId), gte(packageDepartures.departureDate, today), ne(packageDepartures.status, "cancelled"))).orderBy(asc(packageDepartures.departureDate)).limit(12),
      db.select().from(packageRates).where(and(eq(packageRates.packageId, packageId), eq(packageRates.isActive, true), eq(packageRates.paxType, "adult"))),
    ]);
    const pricer = await pricerForAgency(opts.agencyId, rates.map((r) => r.id));
    const rooms = [...new Set(rates.map((r) => r.roomType))];
    const priceFor = (depId: string | null, room: string) => {
      const r = rates.find((x) => x.departureId === depId && x.roomType === room) ?? rates.find((x) => x.departureId === null && x.roomType === room);
      return r ? money(pricer.price({ id: r.id, basePrice: Number(r.basePrice) }), pkg.currency) : "—";
    };
    const rowsFor = deps.length ? deps.map((d) => [esc(`${fmtDate(d.departureDate)}${d.returnDate ? ` – ${fmtDate(d.returnDate)}` : ""}`), ...rooms.map((room) => esc(priceFor(d.id, room)))]) : [["On request", ...rooms.map((room) => esc(priceFor(null, room)))]];
    if (rooms.length) pricesHtml = section("Prices per adult", table([{ label: "Departure" }, ...rooms.map((r) => ({ label: ROOM_LABEL[r] ?? r, align: "right" as const }))], rowsFor));
  }

  const facts: [string, string | null][] = [
    ["Product", VERTICAL_LABEL[pkg.vertical]],
    ["Destination", extra.destination],
    ["Duration", pkg.durationDays ? `${pkg.durationDays} days${pkg.durationNights ? ` / ${pkg.durationNights} nights` : ""}` : null],
    ["Meals", pkg.mealPlan],
    ["Hotels", pkg.hotelCategory],
    ["Includes", [pkg.visaIncluded && "Visa", pkg.airTicketIncluded && "Air ticket", pkg.transportIncluded && "Transport", pkg.ziyaratIncluded && "Ziyarat"].filter(Boolean).join(", ") || null],
  ];
  const list = (items: string[]) => `<ul class="plain">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const body =
    `<h2 style="margin:12px 0 2px;font-size:18px">${esc(pkg.name)}</h2>${pkg.summary ? `<p class="muted" style="margin:0">${esc(pkg.summary)}</p>` : ""}` +
    coverHtml +
    `<div class="blocks"><div class="block"><h4>At a glance</h4><dl>${facts.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div></div>` +
    (pkg.description ? section("About this package", `<p>${multiline(pkg.description)}</p>`) : "") +
    (extra.hotels.length ? section("Hotels", hotelsTable(extra.hotels)) : "") +
    (extra.itinerary.length ? section("Itinerary", itineraryHtml(extra.itinerary)) : "") +
    (pkg.inclusions.length ? section("Included", list(pkg.inclusions)) : "") +
    (pkg.exclusions.length ? section("Not included", list(pkg.exclusions)) : "") +
    pricesHtml;
  const html = renderDocument(ctx, { number: pkg.code, body });
  return toPdf(ctx, html, `${pkg.code} ${pkg.name}.pdf`, pkg.code);
}

// ================================================================================
// Departure passenger list (operations: everyone travelling on one departure)
// ================================================================================
export async function departurePassengerList(departureId: string): Promise<GeneratedDocument> {
  const [dep] = await db.select({ d: packageDepartures, pkgName: packages.name, pkgCode: packages.code }).from(packageDepartures).innerJoin(packages, eq(packages.id, packageDepartures.packageId)).where(eq(packageDepartures.id, departureId)).limit(1);
  if (!dep) throw notFound("Departure not found");
  const rows = await db
    .select({ ref: bookings.reference, status: bookings.status, agency: agencies.agencyName, code: agencies.agentCode, p: bookingPassengers })
    .from(bookingPassengers)
    .innerJoin(bookings, eq(bookings.id, bookingPassengers.bookingId))
    .innerJoin(agencies, eq(agencies.id, bookings.agencyId))
    .where(and(eq(bookings.departureId, departureId), inArray(bookings.status, [...CONFIRMED, "submitted", "under_review", "awaiting_payment", "payment_pending_verification"])))
    .orderBy(asc(bookings.reference), asc(bookingPassengers.sortOrder));
  const ctx = await docContext("passenger_list");
  const html = renderDocument(ctx, {
    number: dep.pkgCode,
    date: new Date(),
    blocks: [{ title: "Departure", rows: [["Package", `${dep.pkgName} (${dep.pkgCode})`], ["Travel", `${fmtDate(dep.d.departureDate)} – ${fmtDate(dep.d.returnDate)}`], ["Seats", `${dep.d.seatsSold} sold, ${dep.d.seatsHeld} held${dep.d.capacity ? ` of ${dep.d.capacity}` : ""}`], ["Passengers listed", String(rows.length)]] }],
    body: table(
      [{ label: "#", width: "22px" }, { label: "Booking" }, { label: "Agency" }, { label: "Name" }, { label: "Gender" }, { label: "Date of birth" }, { label: "Passport" }, { label: "Expires" }, { label: "Type" }, { label: "Room" }, { label: "Status" }],
      rows.map((r, i) => [String(i + 1), esc(r.ref), esc(`${r.agency}${r.code ? ` (${r.code})` : ""}`), esc(r.p.fullName), esc(GENDER_LABEL[r.p.gender ?? ""] ?? ""), esc(fmtDate(r.p.dateOfBirth)), esc(r.p.passportNumber), esc(fmtDate(r.p.passportExpiryDate)), esc(PAX_LABEL[r.p.paxType] ?? r.p.paxType), esc(r.p.roomType ? ROOM_LABEL[r.p.roomType] ?? r.p.roomType : ""), esc(BOOKING_STATUS_LABEL[r.status])]),
    ),
  });
  return toPdf(ctx, html, `${ctx.title} ${dep.pkgCode} ${dep.d.departureDate}.pdf`, dep.pkgCode, true);
}
