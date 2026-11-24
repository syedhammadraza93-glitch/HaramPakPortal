import type { AgencyStatus } from "../../utils/api";

export interface AgencyDocument {
  id: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  verified: boolean;
  createdAt: string;
}

export interface AgencyProfile {
  id: string;
  agentCode: string | null;
  agencyName: string;
  authorizedPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  country: string;
  cnic: string | null;
  ntn: string | null;
  businessRegNo: string | null;
  licenceNo: string | null;
  status: AgencyStatus;
  createdAt: string;
  approvedAt: string | null;
  documents: AgencyDocument[];
  statusReason: string | null;
  editableFields: string[];
  canUploadDocuments: boolean;
  canResubmit: boolean;
}

export const PROFILE_FIELDS: { key: keyof AgencyProfile; label: string }[] = [
  { key: "agencyName", label: "Agency name" },
  { key: "authorizedPerson", label: "Authorized person" },
  { key: "phone", label: "Mobile" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "cnic", label: "CNIC" },
  { key: "ntn", label: "NTN" },
  { key: "businessRegNo", label: "Business registration no." },
  { key: "licenceNo", label: "Travel agency licence no." },
];
