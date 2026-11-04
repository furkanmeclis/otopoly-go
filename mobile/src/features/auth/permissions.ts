/**
 * Permission slugs — same catalog as web `frontend/src/config/permissions.ts` (tenant subset).
 * Owner-only paths additionally require the organization membership role `owner` (see `ownerOnly`).
 */
export const P = {
  jobsRead: 'tenant.jobs.read',
  jobsWrite: 'tenant.jobs.write',
  jobsExport: 'tenant.jobs.export',
  customersRead: 'tenant.customers.read',
  customersWrite: 'tenant.customers.write',
  cariRead: 'tenant.cari.read',
  cariWrite: 'tenant.cari.write',
  cariExport: 'tenant.cari.export',
  financeRead: 'tenant.finance.read',
  financeWrite: 'tenant.finance.write',
  financeExport: 'tenant.finance.export',
  financeImport: 'tenant.finance.import',
  salesRead: 'tenant.sales.read',
  salesWrite: 'tenant.sales.write',
  salesExport: 'tenant.sales.export',
  suppliersExport: 'tenant.suppliers.export',
  purchasesExport: 'tenant.purchases.export',
  suppliersRead: 'tenant.suppliers.read',
  suppliersWrite: 'tenant.suppliers.write',
  purchasesRead: 'tenant.purchases.read',
  purchasesWrite: 'tenant.purchases.write',
  catalogRead: 'tenant.catalog.read',
  catalogWrite: 'tenant.catalog.write',
  catalogExport: 'tenant.catalog.export',
  staffRead: 'tenant.staff.read',
  staffWrite: 'tenant.staff.write',
  reportsRead: 'tenant.reports.read',
  reportsExport: 'tenant.reports.export',
  contractsRead: 'tenant.contracts.read',
  contractsWrite: 'tenant.contracts.write',
  leadsRead: 'tenant.leads.read',
  leadsWrite: 'tenant.leads.write',
  quotesRead: 'tenant.quotes.read',
  quotesWrite: 'tenant.quotes.write',
  todosRead: 'tenant.todos.read',
  todosWrite: 'tenant.todos.write',
  calendarRead: 'tenant.calendar.read',
  calendarWrite: 'tenant.calendar.write',
  reviewsRead: 'tenant.reviews.read',
  reviewsWrite: 'tenant.reviews.write',
  loyaltyRead: 'tenant.loyalty.read',
  loyaltyApply: 'tenant.loyalty.apply',
  loyaltyWrite: 'tenant.loyalty.write',
  aiUse: 'tenant.ai.use',
  messagingRead: 'tenant.messaging.read',
  messagingWrite: 'tenant.messaging.write',
  billingRead: 'tenant.billing.read',
  billingWrite: 'tenant.billing.write',
  settingsRead: 'tenant.settings.read',
  settingsWrite: 'tenant.settings.write',
  importsRead: 'tenant.imports.read',
  /** User-level inbox (`/v1/notifications*`). */
  notificationsRead: 'notifications.read',
} as const;

export type Permission = (typeof P)[keyof typeof P];

/** A gate: permission slug, optionally combined with the owner membership requirement. */
export type Gate = { perm?: Permission; owner?: boolean };

/** Backend rule: these writes are refused unless the org membership role is `owner`. */
export const ownerOnly = (perm: Permission): Gate => ({ perm, owner: true });
