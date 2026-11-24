import puppeteer, { type Browser } from "puppeteer";

/**
 * HTML → PDF with headless Chromium (Puppeteer). One browser is shared and started on first use; at most three PDFs are
 * rendered at a time so a burst of downloads cannot exhaust memory.
 */
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({ headless: true, args: process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [] })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

const MAX_PAGES = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  if (active >= MAX_PAGES) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface PdfOptions {
  landscape?: boolean;
  /** Small text at the bottom left of every page (e.g. company name and document number). */
  footerNote?: string;
}

export async function htmlToPdf(html: string, opts: PdfOptions = {}): Promise<Buffer> {
  await acquire();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      const pdf = await page.pdf({
        format: "A4",
        landscape: !!opts.landscape,
        printBackground: true,
        margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          `<div style="font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#888;width:100%;padding:0 12mm;display:flex;justify-content:space-between">` +
          `<span>${esc(opts.footerNote ?? "")}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    release();
  }
}

/** Closes the shared browser (tests and shutdown). */
export async function closePdfBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) await (await p).close().catch(() => undefined);
}
