/**
 * Compile-time contract: what the Go API sends (response schemas from openapi.yaml, generated into
 * `generated/api.d.ts`) must be assignable to the hand-written app types the screens use. If the
 * backend adds a required field, changes a type or makes a field optional that the app requires,
 * `npx tsc --noEmit` fails here. Runtime shapes are checked by `npm run test:contract`.
 * Type-only module: nothing is emitted or imported at runtime.
 */
import type { components } from '@/api/generated/api';
import type { CariAccount, CariAccountDetail, CariEntry, CariSummary } from '@/features/cari/services/cari.service';
import type { Customer, CustomerDetail, CustomerVehicle } from '@/features/customers/services/customers.service';
import type { Job, JobConsumption, JobDetail, JobLine, JobPayment, JobsSummary } from '@/features/jobs/services/jobs.service';
import type { Purchase, PurchaseDetail, PurchaseLine } from '@/features/purchases/services/purchases.service';
import type { Sale, SaleDetail, SaleLine, SalesSummary } from '@/features/sales/services/sales.service';
import type { StaffMember } from '@/features/staff/services/staff.service';
import type { ReorderList, ReorderProductOverride, ReorderSettings, ReorderSuggestion, ReorderSummary } from '@/features/stock-reorder/types';
import type { Supplier } from '@/features/suppliers/services/suppliers.service';

type S = components['schemas'];
/** Resolves to `true` only when the API shape `Api` can be used where the app expects `App`. */
type Accepts<App, Api> = [Api] extends [App] ? true : { error: 'API response not assignable to app type'; api: Api; app: App };
type Check<T extends true> = T;

export type ResponseContract = [
  Check<Accepts<Job, S['Job']>>,
  Check<Accepts<JobDetail, S['JobDetail']>>,
  Check<Accepts<JobLine, S['JobLine']>>,
  Check<Accepts<JobPayment, S['JobPayment']>>,
  Check<Accepts<JobConsumption, S['JobConsumption']>>,
  Check<Accepts<JobsSummary, S['JobsSummary']>>,
  Check<Accepts<Customer, S['Customer']>>,
  Check<Accepts<CustomerDetail, S['CustomerDetail']>>,
  Check<Accepts<CustomerVehicle, S['CustomerVehicle']>>,
  Check<Accepts<Sale, S['Sale']>>,
  Check<Accepts<SaleDetail, S['SaleDetail']>>,
  Check<Accepts<SaleLine, S['SaleLine']>>,
  Check<Accepts<SalesSummary, S['SalesSummary']>>,
  Check<Accepts<Purchase, S['Purchase']>>,
  Check<Accepts<PurchaseDetail, S['PurchaseDetail']>>,
  Check<Accepts<PurchaseLine, S['PurchaseLine']>>,
  Check<Accepts<Supplier, S['Supplier']>>,
  Check<Accepts<StaffMember, S['StaffMember']>>,
  Check<Accepts<CariAccount, S['CariAccount']>>,
  Check<Accepts<CariAccountDetail, S['CariAccountDetail']>>,
  Check<Accepts<CariEntry, S['CariEntry']>>,
  Check<Accepts<CariSummary, S['CariSummary']>>,
  Check<Accepts<ReorderSuggestion, S['StockReorderSuggestion']>>,
  Check<Accepts<ReorderSummary, S['StockReorderSummary']>>,
  Check<Accepts<ReorderSettings, S['StockReorderSettings']>>,
  Check<Accepts<ReorderProductOverride, S['StockReorderProductOverride']>>,
  Check<Accepts<ReorderList, S['StockReorderList']>>,
];
