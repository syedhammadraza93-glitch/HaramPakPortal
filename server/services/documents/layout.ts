import { eq } from "drizzle-orm";
import { db } from "../../database/connection";
import { documentTemplates } from "../../database/schema";
import { DOCUMENT_TYPES, type DocumentType } from "../../utils/documentTypes";
import { getCompany, type Company } from "../settings.service";
import { readStoredFile } from "../storage.service";

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Escaped text with line breaks kept. */
export const multiline = (v: string | null | undefined) => esc(v ?? "").replace(/\n/g, "<br>");

export function money(amount: number | string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = Number(amount);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "";
  const iso = typeof v === "string" ? v : v.toISOString();
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ---------- Amount in words (international system) ----------
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
  const r = n % 100;
  if (r) parts.push(r < 20 ? ONES[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  return parts.join(" ");
}
export function amountInWords(amount: number, currency: string): string {
  const whole = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  const scales = ["", " thousand", " million", " billion"];
  const parts: string[] = [];
  let n = whole;
  for (let i = 0; n > 0 && i < scales.length; i++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${below1000(chunk)}${scales[i]}`);
  }
  const words = parts.length ? parts.join(" ") : "zero";
  const text = `${currency} ${words}${cents ? ` and ${below1000(cents)} cents` : ""} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------- Context: branding + template text ----------
export interface DocContext {
  company: Company;
  logo: string | null;
  title: string;
  introText: string | null;
  footerText: string | null;
}

/** Branding only (reports): company details and logo with a given title. */
export async function brandContext(title: string): Promise<DocContext> {
  const company = await getCompany();
  let logo: string | null = null;
  if (company.logoKey && company.logoMime) {
    try {
      logo = `data:${company.logoMime};base64,${(await readStoredFile(company.logoKey)).toString("base64")}`;
    } catch {
      logo = null;
    }
  }
  return { company, logo, title, introText: null, footerText: null };
}

export async function docContext(type: DocumentType): Promise<DocContext> {
  const [tpl] = await db.select().from(documentTemplates).where(eq(documentTemplates.type, type)).limit(1);
  const ctx = await brandContext(tpl?.title ?? DOCUMENT_TYPES.find((d) => d.type === type)!.title);
  return { ...ctx, introText: tpl?.introText ?? null, footerText: tpl?.footerText ?? null };
}

export interface Block {
  title: string;
  /** Label / value pairs; empty values are left out. */
  rows: [string, string | null | undefined][];
}

export interface DocumentParts {
  number?: string | null;
  date?: string | Date | null;
  /** Extra lines under the number (e.g. "Valid until …"). */
  headerLines?: string[];
  blocks?: Block[];
  /** Already-escaped HTML. */
  body: string;
  /** Extra already-escaped HTML after the body, before the template footer (e.g. bank details). */
  afterBody?: string;
}

/** A table. `cells` must already be escaped HTML. */
export function table(head: { label: string; align?: "right" | "center"; width?: string }[], rows: string[][], foot?: string[][]): string {
  const th = head.map((h) => `<th style="${h.align ? `text-align:${h.align};` : ""}${h.width ? `width:${h.width};` : ""}">${esc(h.label)}</th>`).join("");
  const tr = (r: string[], tag = "td") => `<tr>${r.map((c, i) => `<${tag}${head[i]?.align ? ` style="text-align:${head[i]!.align}"` : ""}>${c}</${tag}>`).join("")}</tr>`;
  return `<table class="grid"><thead><tr>${th}</tr></thead><tbody>${rows.length ? rows.map((r) => tr(r)).join("") : `<tr><td colspan="${head.length}" class="muted" style="text-align:center">Nothing to show</td></tr>`}</tbody>${foot?.length ? `<tfoot>${foot.map((r) => tr(r)).join("")}</tfoot>` : ""}</table>`;
}

export const section = (title: string, html: string) => `<section><h3>${esc(title)}</h3>${html}</section>`;

/** Full HTML page for a document, branded from Settings. */
export function renderDocument(ctx: DocContext, parts: DocumentParts): string {
  const c = ctx.company;
  const primary = /^#[0-9a-f]{6}$/i.test(c.primaryColor) ? c.primaryColor : "#0F766E";
  const contact = [c.phone, c.email, c.website].filter(Boolean).map(esc).join(" · ");
  const blocks = (parts.blocks ?? [])
    .map((b) => {
      const rows = b.rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
      if (!rows.length) return "";
      return `<div class="block"><h4>${esc(b.title)}</h4><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${multiline(v)}</dd>`).join("")}</dl></div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(ctx.title)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #1f2937; margin: 0; line-height: 1.45; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid ${primary}; padding-bottom: 10px; }
    .brand { display: flex; gap: 12px; align-items: center; }
    .brand img { max-height: 60px; max-width: 160px; object-fit: contain; }
    .brand .name { font-size: 17px; font-weight: bold; color: ${primary}; }
    .brand .addr { color: #4b5563; font-size: 9.5px; }
    .doc { text-align: right; }
    .doc .title { font-size: 20px; font-weight: bold; color: ${primary}; text-transform: uppercase; letter-spacing: .5px; }
    .doc .num { font-family: Consolas, Menlo, monospace; font-size: 11.5px; margin-top: 2px; }
    .doc .line { color: #4b5563; font-size: 9.5px; }
    .intro { margin: 10px 0 0; color: #374151; }
    .blocks { display: flex; gap: 12px; margin: 12px 0; }
    .block { flex: 1; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
    .block h4 { margin: 0 0 4px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .5px; color: ${primary}; }
    .block dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
    .block dt { color: #6b7280; } .block dd { margin: 0; font-weight: 600; }
    section { margin-top: 12px; page-break-inside: auto; }
    h3 { font-size: 11.5px; color: ${primary}; margin: 0 0 5px; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; }
    table.grid { width: 100%; border-collapse: collapse; }
    table.grid th { background: ${primary}; color: #fff; text-align: left; font-size: 9.5px; padding: 5px 6px; }
    table.grid td { border-bottom: 1px solid #e5e7eb; padding: 4px 6px; vertical-align: top; }
    table.grid tr { page-break-inside: avoid; }
    table.grid tfoot td { font-weight: bold; border-top: 2px solid #d1d5db; border-bottom: 0; }
    .muted { color: #6b7280; } .right { text-align: right; } .small { font-size: 9px; }
    .total { margin-top: 8px; display: flex; justify-content: flex-end; }
    .total div { background: ${primary}; color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: bold; }
    .words { text-align: right; font-style: italic; color: #4b5563; margin-top: 3px; }
    .note { background: #f8fafc; border-left: 3px solid ${primary}; padding: 6px 10px; margin-top: 8px; }
    .terms { margin-top: 16px; border-top: 1px solid #e5e7eb; padding-top: 8px; color: #4b5563; font-size: 9.5px; }
    .company-footer { margin-top: 6px; color: #9ca3af; font-size: 9px; text-align: center; }
    ul.plain { margin: 0; padding-left: 16px; }
    .cover { width: 100%; max-height: 230px; object-fit: cover; border-radius: 6px; margin-top: 10px; }
  </style></head><body>
    <div class="head">
      <div class="brand">
        ${ctx.logo ? `<img src="${ctx.logo}" alt="">` : ""}
        <div><div class="name">${esc(c.name)}</div>${c.address ? `<div class="addr">${multiline(c.address)}</div>` : ""}${contact ? `<div class="addr">${contact}</div>` : ""}</div>
      </div>
      <div class="doc">
        <div class="title">${esc(ctx.title)}</div>
        ${parts.number ? `<div class="num">No. ${esc(parts.number)}</div>` : ""}
        ${parts.date ? `<div class="line">Date: ${esc(fmtDate(parts.date))}</div>` : ""}
        ${(parts.headerLines ?? []).map((l) => `<div class="line">${esc(l)}</div>`).join("")}
      </div>
    </div>
    ${ctx.introText ? `<p class="intro">${multiline(ctx.introText)}</p>` : ""}
    ${blocks ? `<div class="blocks">${blocks}</div>` : ""}
    ${parts.body}
    ${parts.afterBody ?? ""}
    ${ctx.footerText ? `<div class="terms">${multiline(ctx.footerText)}</div>` : ""}
    ${c.footerText ? `<div class="company-footer">${esc(c.footerText)}</div>` : ""}
  </body></html>`;
}
