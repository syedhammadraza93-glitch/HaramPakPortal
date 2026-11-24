/**
 * Ledger accounts the posting rules need. They are technical (the rules refer to them by key), so they are created
 * once by the seed; the admin can rename them. Company bank accounts are NOT here: the admin adds those.
 */
export const SYSTEM_ACCOUNTS = [
  { key: "agency_receivable", code: "1100", name: "Agency receivables", type: "asset", sortOrder: 10 },
  { key: "opening_balance_equity", code: "3000", name: "Opening balances", type: "equity", sortOrder: 30 },
  { key: "sales_umrah", code: "4100", name: "Sales – Umrah", type: "income", sortOrder: 41 },
  { key: "sales_hajj", code: "4200", name: "Sales – Hajj", type: "income", sortOrder: 42 },
  { key: "sales_tourism", code: "4300", name: "Sales – International Tourism", type: "income", sortOrder: 43 },
  { key: "other_income", code: "4900", name: "Other charges to agencies", type: "income", sortOrder: 49 },
  { key: "sales_returns", code: "4950", name: "Refunds and credit notes", type: "expense", sortOrder: 50 },
  { key: "agency_discounts", code: "5900", name: "Discounts and credit adjustments", type: "expense", sortOrder: 59 },
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]["key"];
