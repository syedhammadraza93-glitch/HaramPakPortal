/**
 * Single source of truth for permissions and built-in roles.
 * database/seeds/seed.ts syncs these into the database on every server start.
 */
export const PERMISSIONS = [
  { code: "dashboard.admin", module: "admin", description: "Access the admin portal dashboard" },
  { code: "agent.view", module: "agency", description: "View agencies and registrations" },
  { code: "agent.approve", module: "agency", description: "Approve, reject, request information on or reopen registrations" },
  { code: "agent.suspend", module: "agency", description: "Suspend and reactivate agencies" },
  { code: "agent.deactivate", module: "agency", description: "Deactivate agencies and reactivate deactivated agencies" },
  { code: "agent.edit", module: "agency", description: "Edit agency profiles" },
  { code: "agent.notes", module: "agency", description: "Add internal notes on agencies" },
  { code: "agent.access", module: "agency", description: "Manage an agency’s portal access" },
  { code: "user.manage", module: "identity", description: "Manage internal staff users" },
  { code: "role.manage", module: "identity", description: "Manage roles and permissions" },
  { code: "settings.manage", module: "settings", description: "Manage company and sign-up settings" },
  { code: "audit.view", module: "audit", description: "View the audit log" },
  { code: "catalogue.view", module: "catalogue", description: "View packages, destinations and hotels" },
  { code: "catalogue.manage", module: "catalogue", description: "Create, edit, publish and archive packages; manage destinations, hotels, policies and checklists" },
  { code: "pricing.manage", module: "pricing", description: "Set package prices, pricing groups, agency special prices and visa rates" },
  { code: "booking.view", module: "booking", description: "View bookings, passengers and documents" },
  { code: "booking.manage", module: "booking", description: "Process bookings: review, request information, quotations, confirm, reject, cancel, issue documents" },
  { code: "finance.view", module: "finance", description: "View agency ledgers, balances, payments, journal and booking costs" },
  { code: "finance.manage", module: "finance", description: "Verify payments, set credit limits, request adjustments, manage bank accounts, suppliers and costs" },
  { code: "finance.approve", module: "finance", description: "Approve another user's finance requests (opening balances, adjustments, credit notes, refunds, reversals) and close months" },
  { code: "report.view", module: "reports", description: "View and export sales, collections and cancellation reports (receivables and profit also need finance.view)" },
  { code: "announcement.manage", module: "reports", description: "Send announcements to agents" },
  { code: "crm.work", module: "crm", description: "Work leads assigned to this user" },
  { code: "crm.manage", module: "crm", description: "Access all leads, assign owners and configure escalation" },
  { code: "integration.manage", module: "integrations", description: "Manage integration credentials and settings" },
  { code: "website.edit", module: "website", description: "Edit website content drafts" },
  { code: "website.publish", module: "website", description: "Publish approved website content" },
  { code: "portal.agent", module: "agent", description: "Use the agent portal" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

export const BUILT_IN_ROLES: RoleDefinition[] = [
  {
    code: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Full platform configuration and access",
    permissions: PERMISSIONS.map((p) => p.code).filter((c) => c !== "portal.agent"),
  },
  {
    code: "SALES_MANAGER",
    name: "Sales / Agent Manager",
    description: "Agent onboarding, relationships and agent status",
    permissions: ["dashboard.admin", "crm.work", "crm.manage", "agent.view", "agent.approve", "agent.suspend", "agent.edit", "agent.notes", "agent.access", "catalogue.view", "pricing.manage", "booking.view", "finance.view", "report.view", "announcement.manage"],
  },
  {
    code: "OPERATIONS_ADMIN",
    name: "Operations Admin",
    description: "Packages and bookings",
    permissions: ["dashboard.admin", "agent.view", "catalogue.view", "catalogue.manage", "booking.view", "booking.manage", "finance.view", "report.view"],
  },
  {
    code: "FINANCE_MANAGER",
    name: "Finance Manager",
    description: "Ledgers, payments, credit and approvals",
    permissions: ["dashboard.admin", "agent.view", "catalogue.view", "booking.view", "finance.view", "finance.manage", "finance.approve", "report.view"],
  },
  {
    code: "SALES_REP",
    name: "Sales Representative",
    description: "Create and work assigned enquiries",
    permissions: ["dashboard.admin", "crm.work"],
  },
  {
    code: "WEBSITE_EDITOR",
    name: "Website Editor",
    description: "Prepare public website content",
    permissions: ["website.edit"],
  },
  {
    code: "WEBSITE_PUBLISHER",
    name: "Website Publisher",
    description: "Review and publish public website content",
    permissions: ["website.publish"],
  },
  {
    code: "TRAVEL_AGENT",
    name: "Travel Agent",
    description: "Registered travel agency user",
    permissions: ["portal.agent"],
  },
];

/** Built-in roles whose permissions cannot be edited from the UI. */
export const LOCKED_ROLES = ["SUPER_ADMIN", "TRAVEL_AGENT"];
export const AGENT_ROLE = "TRAVEL_AGENT";
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
