import PDFDocument from "pdfkit";
import type { leadQuotes } from "../database/schema";

export async function renderLeadQuotePdf(number: string, quote: typeof leadQuotes.$inferSelect): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: "Travel quotation " + number, Author: "Haram Pak Travel & Tours" } });
  const pdf = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const green = "#173C30";
  const money = (minor: number) => new Intl.NumberFormat("en-PK", { currency: quote.currency, style: "currency", currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  doc.fillColor(green).font("Helvetica-Bold").fontSize(24).text("Haram Pak Travel & Tours");
  doc.moveDown(0.4).fontSize(17).text("Travel quotation");
  doc.font("Helvetica").fontSize(11).text(number);
  doc.moveDown().text("Prepared for " + quote.customerName);
  doc.text("Issued " + quote.issuedAt.toISOString().slice(0, 10) + "  |  Valid through " + quote.validUntil);
  doc.moveDown(1.6);
  const [itemX, qtyX, unitX, amountX] = [50, 300, 350, 450];
  const drawHeading = () => {
    const y = doc.y;
    doc.fillColor(green).font("Helvetica-Bold").fontSize(10);
    doc.text("Item", itemX, y, { width: 230 }).text("Qty", qtyX, y, { width: 40 });
    doc.text("Unit price", unitX, y, { width: 94, align: "right" }).text("Line total", amountX, y, { width: 95, align: "right" });
    doc.x = itemX;
    doc.y = y + 22;
  };
  drawHeading();
  for (const line of quote.lines) {
    doc.font("Helvetica").fontSize(10);
    const height = doc.heightOfString(line.label, { width: 230 }) + 15;
    if (doc.y + height > doc.page.height - 65) {
      doc.addPage();
      drawHeading();
      doc.font("Helvetica").fontSize(10);
    }
    const y = doc.y;
    doc.text(line.label, itemX, y, { width: 230 }).text(String(line.quantity), qtyX, y, { width: 40 });
    doc.text(money(line.unitMinor), unitX, y, { width: 94, align: "right" });
    doc.text(money(line.quantity * line.unitMinor), amountX, y, { width: 95, align: "right" });
    doc.moveTo(itemX, y + height - 6).lineTo(545, y + height - 6).strokeColor("#CBDCD2").stroke();
    doc.x = itemX;
    doc.y = y + height;
  }
  if (doc.y + 80 > doc.page.height - 50) doc.addPage();
  const total = quote.lines.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0);
  doc.moveDown().fillColor(green).font("Helvetica-Bold").fontSize(15).text("Total " + money(total), { align: "right" });
  if (quote.terms) {
    doc.moveDown().fontSize(12).text("Terms and inclusions");
    doc.font("Helvetica").fontSize(10).text(quote.terms);
  }
  doc.end();
  return pdf;
}
