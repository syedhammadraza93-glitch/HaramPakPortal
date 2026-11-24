import type { DocumentType } from "../database/schema";
import type { FieldMode } from "../database/schema";

export interface RegistrationFieldDef {
  field: string;
  label: string;
  kind: "text" | "file";
  defaultMode: FieldMode;
  sortOrder: number;
  /** For file fields: the document type stored in agency_documents. */
  docType?: DocumentType;
}

/** Sign-up fields whose Required / Optional / Hidden setting the Super Admin can change. */
export const REGISTRATION_FIELDS: RegistrationFieldDef[] = [
  { field: "cnic", label: "CNIC number", kind: "text", defaultMode: "required", sortOrder: 1 },
  { field: "cnicCopy", label: "CNIC copy (front & back)", kind: "file", defaultMode: "required", sortOrder: 2, docType: "cnic_copy" },
  { field: "ntn", label: "NTN", kind: "text", defaultMode: "optional", sortOrder: 3 },
  { field: "businessRegNo", label: "Business registration number", kind: "text", defaultMode: "optional", sortOrder: 4 },
  { field: "registrationDoc", label: "Business registration certificate", kind: "file", defaultMode: "optional", sortOrder: 5, docType: "registration_cert" },
  { field: "licenceNo", label: "Travel agency licence number", kind: "text", defaultMode: "optional", sortOrder: 6 },
  { field: "licenceDoc", label: "Travel agency licence copy", kind: "file", defaultMode: "optional", sortOrder: 7, docType: "licence" },
];

export const FILE_FIELDS = REGISTRATION_FIELDS.filter((f) => f.kind === "file");
export const TEXT_FIELDS = REGISTRATION_FIELDS.filter((f) => f.kind === "text");
/** Extra optional documents an agent may attach at sign-up. */
export const OTHER_DOCS_FIELD = "otherDocs";
export const MAX_OTHER_DOCS = 3;
