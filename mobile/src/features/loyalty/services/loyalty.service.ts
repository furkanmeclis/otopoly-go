/** Loyalty API (`/v1/tenant/loyalty/*`; web `features/loyalty/services/loyalty.service.ts`). */
import { request } from '@/api/client';
import type { ListPage } from '@/api/types';

import type {
  ApplyInput,
  CampaignInput,
  CancelResult,
  CustomerLoyalty,
  CustomerPackage,
  CustomerPackageDetail,
  JobLoyalty,
  LoyaltyCampaign,
  LoyaltyOverview,
  LoyaltyPackage,
  LoyaltyPlan,
  PackageInput,
  PaymentInput,
  PlanInput,
  SellPackageInput,
  StartSubscriptionInput,
  Subscription,
  SubscriptionDetail,
} from '../types';

type Params = Record<string, string | number | undefined>;
const base = '/v1/tenant/loyalty';

export const loyaltyService = {
  overview: (days?: number) => request<LoyaltyOverview>('GET', `${base}/overview`, { query: days ? { days } : undefined, silent: true }),

  listCampaigns: (params: Params = {}) => request<ListPage<LoyaltyCampaign>>('GET', `${base}/campaigns`, { query: params }),
  createCampaign: (body: CampaignInput) => request<LoyaltyCampaign>('POST', `${base}/campaigns`, { body }),
  updateCampaign: (uuid: string, body: CampaignInput) => request<LoyaltyCampaign>('PUT', `${base}/campaigns/${uuid}`, { body }),
  deleteCampaign: (uuid: string) => request<{ deleted: boolean }>('DELETE', `${base}/campaigns/${uuid}`),

  listPackages: (params: Params = {}) => request<ListPage<LoyaltyPackage>>('GET', `${base}/packages`, { query: params }),
  createPackage: (body: PackageInput) => request<LoyaltyPackage>('POST', `${base}/packages`, { body }),
  updatePackage: (uuid: string, body: PackageInput) => request<LoyaltyPackage>('PUT', `${base}/packages/${uuid}`, { body }),
  deletePackage: (uuid: string) => request<{ deleted: boolean }>('DELETE', `${base}/packages/${uuid}`),

  listPlans: (params: Params = {}) => request<ListPage<LoyaltyPlan>>('GET', `${base}/plans`, { query: params }),
  createPlan: (body: PlanInput) => request<LoyaltyPlan>('POST', `${base}/plans`, { body }),
  updatePlan: (uuid: string, body: PlanInput) => request<LoyaltyPlan>('PUT', `${base}/plans/${uuid}`, { body }),
  deletePlan: (uuid: string) => request<{ deleted: boolean }>('DELETE', `${base}/plans/${uuid}`),

  /** `state`: active | expired | used_up | cancelled. */
  listCustomerPackages: (params: Params = {}) => request<ListPage<CustomerPackage>>('GET', `${base}/customer-packages`, { query: params }),
  getCustomerPackage: (uuid: string) => request<CustomerPackageDetail>('GET', `${base}/customer-packages/${uuid}`),
  sellPackage: (body: SellPackageInput) => request<CustomerPackageDetail>('POST', `${base}/customer-packages`, { body }),
  /** No credit used → the payment is voided (`refunded`); otherwise the remaining credits lapse. */
  cancelCustomerPackage: (uuid: string) => request<CancelResult>('POST', `${base}/customer-packages/${uuid}/cancel`),

  /** `state`: active | past_due | cancelled; `due_within_days`: renewals due (overdue included), soonest first. */
  listSubscriptions: (params: Params = {}) => request<ListPage<Subscription>>('GET', `${base}/subscriptions`, { query: params }),
  getSubscription: (uuid: string) => request<SubscriptionDetail>('GET', `${base}/subscriptions/${uuid}`),
  startSubscription: (body: StartSubscriptionInput) => request<SubscriptionDetail>('POST', `${base}/subscriptions`, { body }),
  /** Collects the next unpaid period and moves the renewal date. */
  paySubscription: (uuid: string, body: PaymentInput) => request<SubscriptionDetail>('POST', `${base}/subscriptions/${uuid}/payments`, { body }),
  cancelSubscription: (uuid: string) => request<SubscriptionDetail>('POST', `${base}/subscriptions/${uuid}/cancel`),

  /** Customer 360 section (silent: a plan without the module simply hides it). */
  customerLoyalty: (customerUuid: string) => request<CustomerLoyalty>('GET', `/v1/tenant/customers/${customerUuid}/loyalty`, { silent: true }),
  jobLoyalty: (jobUuid: string) => request<JobLoyalty>('GET', `/v1/tenant/jobs/${jobUuid}/loyalty`, { silent: true }),
  applyToJob: (jobUuid: string, body: ApplyInput) => request<JobLoyalty>('POST', `/v1/tenant/jobs/${jobUuid}/loyalty/apply`, { body }),
  revertOnJob: (jobUuid: string, applicationUuid: string) => request<JobLoyalty>('POST', `/v1/tenant/jobs/${jobUuid}/loyalty/${applicationUuid}/revert`),
};
