import { FileDown, FileText } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../utils/api";
import { useToast } from "./Toast";
import { Button, Card, CardHeader } from "./ui";

export const BOOKING_DOC_LABEL: Record<string, string> = {
  quotation: "Quotation",
  proforma: "Pro forma invoice",
  invoice: "Invoice",
  confirmation: "Booking confirmation",
  voucher: "Travel voucher",
  "passenger-list": "Passenger list",
};

/** Opens a generated PDF in a new tab (the request carries the login token). */
export function PdfButton({ path, label, variant = "secondary", size = "sm", icon = FileDown, download = false }: { path: string; label: string; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md"; icon?: typeof FileDown; download?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      icon={icon}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await (download ? api.downloadFile(path) : api.openFile(path));
        } catch (e) {
          toast("error", errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

/** The PDFs a booking has at its current stage. */
export function BookingDocumentsCard({ basePath, docs }: { basePath: string; docs: string[] | undefined }) {
  if (!docs?.length) return null;
  return (
    <Card>
      <CardHeader icon={FileText} title="Documents" description="Generated with the latest booking details." />
      <div className="flex flex-wrap gap-2 p-5">
        {docs.map((d) => <PdfButton key={d} path={`${basePath}/${d}`} label={BOOKING_DOC_LABEL[d] ?? d} />)}
      </div>
    </Card>
  );
}
