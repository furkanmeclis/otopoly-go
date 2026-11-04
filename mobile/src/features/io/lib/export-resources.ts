import { P, type Permission } from '@/features/auth/permissions';
import { EXPORT_PATHS, type ExportFormat, type IoResource } from '@/features/io/types';

export const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'csv', 'json'];

/**
 * Tenant resources that can be exported from the mobile "new export" sheet, with the permission the
 * backend route requires (web `ResourceIOToolbar` EXPORT_PERM). Catalog resources are left out: their
 * web path (`POST /v1/tenant/exports`) has no backend route yet. Cari statements (`tenant.cari.entries`)
 * are per account, so they are not offered here.
 */
export const TENANT_EXPORTS: { resource: IoResource; perm: Permission; filters: ('q' | 'dates')[] }[] = [
  { resource: 'tenant.jobs', perm: P.jobsExport, filters: ['q', 'dates'] },
  { resource: 'tenant.sales', perm: P.salesExport, filters: ['q', 'dates'] },
  { resource: 'tenant.finance.transactions', perm: P.financeExport, filters: ['q', 'dates'] },
  { resource: 'tenant.finance.accounts', perm: P.financeExport, filters: ['q'] },
  { resource: 'tenant.finance.categories', perm: P.financeExport, filters: ['q'] },
  { resource: 'tenant.cari', perm: P.cariExport, filters: ['q'] },
  { resource: 'tenant.suppliers', perm: P.suppliersExport, filters: ['q'] },
  { resource: 'tenant.purchases', perm: P.purchasesExport, filters: ['q', 'dates'] },
  { resource: 'tenant.reports', perm: P.reportsExport, filters: ['dates'] },
];

export const exportPath = (resource: IoResource) => EXPORT_PATHS[resource];
