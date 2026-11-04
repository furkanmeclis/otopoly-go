/** Loyalty hooks (web `features/loyalty/hooks/use-loyalty.ts`). Keys live under `qk.loyalty` (live targets: `tenant.loyalty.*`). */
import { useQuery } from '@tanstack/react-query';

import { isFeatureDisabled } from '@/api/errors';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { MONEY_KEYS, qk, useInfiniteList } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

import { loyaltyService } from './services/loyalty.service';
import type { ApplyInput, CampaignInput, PackageInput, PaymentInput, PlanInput, SellPackageInput, StartSubscriptionInput } from './types';

type Params = Record<string, string | number | undefined>;

export const loyaltyKeys = {
  all: qk.loyalty,
  overview: (days: number) => [...qk.loyalty, 'overview', days] as const,
  campaigns: [...qk.loyalty, 'campaigns'] as const,
  packages: [...qk.loyalty, 'packages'] as const,
  plans: [...qk.loyalty, 'plans'] as const,
  customerPackages: [...qk.loyalty, 'customer-packages'] as const,
  customerPackage: (uuid: string) => [...qk.loyalty, 'customer-packages', 'detail', uuid] as const,
  subscriptions: [...qk.loyalty, 'subscriptions'] as const,
  subscription: (uuid: string) => [...qk.loyalty, 'subscriptions', 'detail', uuid] as const,
  customer: (uuid: string) => [...qk.loyalty, 'customers', 'detail', uuid] as const,
  job: (uuid: string) => [...qk.loyalty, 'job', uuid] as const,
};

/** Read / apply / write gates (the plan module is checked by the API: FEATURE_DISABLED). */
export function useLoyaltyAccess() {
  const { can } = useAuth();
  return { canRead: can(P.loyaltyRead), canApply: can(P.loyaltyApply), canWrite: can(P.loyaltyWrite) };
}

export const useLoyaltyOverview = (days = 7, enabled = true) =>
  useQuery({ queryKey: loyaltyKeys.overview(days), queryFn: () => loyaltyService.overview(days), enabled, retry: (n, e) => !isFeatureDisabled(e) && n < 2 });

export const useCampaignsInfinite = (params: Params, enabled = true) => useInfiniteList(loyaltyKeys.campaigns, (p) => loyaltyService.listCampaigns(p), params, enabled);
export const usePackagesInfinite = (params: Params, enabled = true) => useInfiniteList(loyaltyKeys.packages, (p) => loyaltyService.listPackages(p), params, enabled);
export const usePlansInfinite = (params: Params, enabled = true) => useInfiniteList(loyaltyKeys.plans, (p) => loyaltyService.listPlans(p), params, enabled);
export const useCustomerPackagesInfinite = (params: Params, enabled = true) =>
  useInfiniteList(loyaltyKeys.customerPackages, (p) => loyaltyService.listCustomerPackages(p), params, enabled);
export const useSubscriptionsInfinite = (params: Params, enabled = true) =>
  useInfiniteList(loyaltyKeys.subscriptions, (p) => loyaltyService.listSubscriptions(p), params, enabled);

/** Active package definitions / plans for the sell and start pickers. */
export const useActivePackages = (enabled = true) =>
  useQuery({ queryKey: [...loyaltyKeys.packages, 'options'], queryFn: () => loyaltyService.listPackages({ is_active: 'true', limit: 100, offset: 0 }), enabled });
export const useActivePlans = (enabled = true) =>
  useQuery({ queryKey: [...loyaltyKeys.plans, 'options'], queryFn: () => loyaltyService.listPlans({ is_active: 'true', limit: 100, offset: 0 }), enabled });

export const useCustomerPackage = (uuid: string) =>
  useQuery({ queryKey: loyaltyKeys.customerPackage(uuid), queryFn: () => loyaltyService.getCustomerPackage(uuid), enabled: Boolean(uuid) });
export const useSubscription = (uuid: string) => useQuery({ queryKey: loyaltyKeys.subscription(uuid), queryFn: () => loyaltyService.getSubscription(uuid), enabled: Boolean(uuid) });

/** Customer 360 / job sections: no retries on a module the plan turned off. */
export const useCustomerLoyalty = (uuid: string, enabled = true) =>
  useQuery({ queryKey: loyaltyKeys.customer(uuid), queryFn: () => loyaltyService.customerLoyalty(uuid), enabled: enabled && Boolean(uuid), retry: (n, e) => !isFeatureDisabled(e) && n < 2 });
export const useJobLoyalty = (uuid: string, enabled = true) =>
  useQuery({ queryKey: loyaltyKeys.job(uuid), queryFn: () => loyaltyService.jobLoyalty(uuid), enabled: enabled && Boolean(uuid), retry: (n, e) => !isFeatureDisabled(e) && n < 2 });

export function useLoyaltyMutations() {
  const { t } = useLocale();
  const inv = [qk.loyalty];
  const money = [qk.loyalty, ...MONEY_KEYS];
  return {
    saveCampaign: useApiMutation({
      key: 'loyalty.campaign.save',
      fn: ({ uuid, body }: { uuid?: string; body: CampaignInput }) => (uuid ? loyaltyService.updateCampaign(uuid, body) : loyaltyService.createCampaign(body)),
      invalidate: inv,
      success: t('loyalty.toasts.saved'),
    }),
    deleteCampaign: useApiMutation({ key: 'loyalty.campaign.delete', fn: (uuid: string) => loyaltyService.deleteCampaign(uuid), invalidate: inv, success: t('loyalty.toasts.archived'), toastValidation: true }),
    savePackage: useApiMutation({
      key: 'loyalty.package.save',
      fn: ({ uuid, body }: { uuid?: string; body: PackageInput }) => (uuid ? loyaltyService.updatePackage(uuid, body) : loyaltyService.createPackage(body)),
      invalidate: inv,
      success: t('loyalty.toasts.saved'),
    }),
    deletePackage: useApiMutation({ key: 'loyalty.package.delete', fn: (uuid: string) => loyaltyService.deletePackage(uuid), invalidate: inv, success: t('loyalty.toasts.archived'), toastValidation: true }),
    savePlan: useApiMutation({
      key: 'loyalty.plan.save',
      fn: ({ uuid, body }: { uuid?: string; body: PlanInput }) => (uuid ? loyaltyService.updatePlan(uuid, body) : loyaltyService.createPlan(body)),
      invalidate: inv,
      success: t('loyalty.toasts.saved'),
    }),
    deletePlan: useApiMutation({ key: 'loyalty.plan.delete', fn: (uuid: string) => loyaltyService.deletePlan(uuid), invalidate: inv, success: t('loyalty.toasts.archived'), toastValidation: true }),
    sell: useApiMutation({ key: 'loyalty.package.sell', fn: (body: SellPackageInput) => loyaltyService.sellPackage(body), invalidate: money, success: t('loyalty.toasts.package_sold') }),
    cancelPackage: useApiMutation({
      key: 'loyalty.package.cancel',
      fn: (uuid: string) => loyaltyService.cancelCustomerPackage(uuid),
      invalidate: money,
      success: (r) => (r.refunded ? t('loyalty.toasts.package_refunded') : t('loyalty.toasts.package_cancelled')),
      toastValidation: true,
    }),
    start: useApiMutation({
      key: 'loyalty.subscription.start',
      fn: (body: StartSubscriptionInput) => loyaltyService.startSubscription(body),
      invalidate: money,
      success: t('loyalty.toasts.subscription_started'),
    }),
    pay: useApiMutation({
      key: 'loyalty.subscription.pay',
      fn: ({ uuid, body }: { uuid: string; body: PaymentInput }) => loyaltyService.paySubscription(uuid, body),
      invalidate: money,
      success: t('loyalty.toasts.payment_recorded'),
    }),
    cancelSubscription: useApiMutation({
      key: 'loyalty.subscription.cancel',
      fn: (uuid: string) => loyaltyService.cancelSubscription(uuid),
      invalidate: inv,
      success: t('loyalty.toasts.subscription_cancelled'),
      toastValidation: true,
    }),
    apply: useApiMutation({
      key: 'loyalty.apply',
      fn: ({ jobUuid, body }: { jobUuid: string; body: ApplyInput }) => loyaltyService.applyToJob(jobUuid, body),
      invalidate: [qk.loyalty, qk.jobs],
      success: t('loyalty.toasts.applied'),
      toastValidation: true,
    }),
    revert: useApiMutation({
      key: 'loyalty.revert',
      fn: ({ jobUuid, applicationUuid }: { jobUuid: string; applicationUuid: string }) => loyaltyService.revertOnJob(jobUuid, applicationUuid),
      invalidate: [qk.loyalty, qk.jobs],
      success: t('loyalty.toasts.reverted'),
      toastValidation: true,
    }),
  };
}
