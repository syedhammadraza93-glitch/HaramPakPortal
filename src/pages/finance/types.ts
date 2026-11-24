export type PaymentStatus = "pending" | "clarification" | "verified" | "rejected" | "reversed";
export type RequestKind = "opening_balance" | "additional_charge" | "credit_adjustment" | "credit_note" | "refund_payout" | "reversal";

export interface CreditInfo {
  currency: string;
  balance: number;
  paymentTerms: "advance" | "credit";
  creditLimit: number;
  creditPolicy: "warn" | "block";
  paymentTermsDays: number;
  available: number;
  pendingPayments: number;
}

export interface CreditCheck {
  amount: number;
  available: number;
  shortBy: number;
  withinCredit: boolean;
  policy: "warn" | "block";
}

export interface StatementLine {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  type: string;
  typeLabel: string;
  description: string;
  bookingId: string | null;
  bookingReference: string | null;
  paymentReference: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface Statement {
  currency: string;
  from: string;
  to: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: StatementLine[];
}

export interface PaymentRow {
  id: string;
  reference: string;
  method: string;
  methodLabel: string;
  amount: number;
  currency: string;
  paidOn: string;
  status: PaymentStatus;
  transactionRef: string | null;
  createdAt: string;
  bookingReference: string | null;
  agencyId?: string;
  agencyName?: string;
  agentCode?: string | null;
  bankName?: string | null;
  files?: number;
  submittedByType?: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PaymentDetail extends PaymentRow {
  bookingId: string | null;
  notes: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedByName?: string | null;
  submittedByName?: string | null;
  submittedBy?: string | null;
  bankAccountId?: string | null;
  entryNumber?: string | null;
  journalEntryId?: string | null;
  attachments: Attachment[];
  canVerify?: boolean;
}

export interface BankOption {
  id: string;
  name: string;
  code?: string;
  isActive?: boolean;
  bankDetails?: string | null;
}

export interface FinanceRequestRow {
  id: string;
  reference: string;
  kind: RequestKind;
  kindLabel: string;
  agencyId: string | null;
  agencyName?: string | null;
  agentCode?: string | null;
  bookingId: string | null;
  bookingReference?: string | null;
  amount: number;
  agencyOwes: boolean;
  accountName?: string | null;
  reversalOfNumber?: string | null;
  entryNumber?: string | null;
  journalEntryId: string | null;
  entryDate: string | null;
  reason: string;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  requestedByName: string;
  reviewedByName: string | null;
  reviewNote: string | null;
  createdAt: string;
  canApprove?: boolean;
}

export interface FinanceOptions {
  currency: string;
  agencies: { id: string; agencyName: string; agentCode: string | null }[];
  banks: BankOption[];
  suppliers: { id: string; name: string; category: string | null }[];
  methods: { value: string; label: string }[];
  requestKinds: { value: RequestKind; label: string }[];
}
