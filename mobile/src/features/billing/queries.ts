import { useQuery } from '@tanstack/react-query';

import { billingService } from '@/features/billing/services/billing.service';
import { qk } from '@/features/queries';

export const billingKeys = {
  overview: [...qk.billing, 'overview'] as const,
};

/** Plan + usage meters (web `useBillingOverview`). Refreshes every minute while mounted. */
export const useBillingOverview = (enabled: boolean) =>
  useQuery({ queryKey: billingKeys.overview, queryFn: () => billingService.overview(), enabled, refetchInterval: 60_000 });
