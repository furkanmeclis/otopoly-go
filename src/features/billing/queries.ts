import { useQuery } from '@tanstack/react-query';

import { billingService } from '@/features/billing/services/billing.service';
import { qk } from '@/features/queries';

export const billingKeys = {
  overview: [...qk.billing, 'overview'] as const,
  orders: [...qk.billing, 'orders'] as const,
  invoices: [...qk.billing, 'invoices'] as const,
  invoiceProfile: [...qk.billing, 'invoice-profile'] as const,
};

/** Read-only billing data (web `use-billing` read hooks). Overview refreshes every minute like the web. */
export const useBillingOverview = (enabled: boolean) =>
  useQuery({ queryKey: billingKeys.overview, queryFn: () => billingService.overview(), enabled, refetchInterval: 60_000 });
export const useBillingOrders = (enabled: boolean) => useQuery({ queryKey: billingKeys.orders, queryFn: () => billingService.orders('all'), enabled });
export const useBillingInvoices = (enabled: boolean) => useQuery({ queryKey: billingKeys.invoices, queryFn: () => billingService.invoices(), enabled });
export const useInvoiceProfile = (enabled: boolean) => useQuery({ queryKey: billingKeys.invoiceProfile, queryFn: () => billingService.invoiceProfile(), enabled });
