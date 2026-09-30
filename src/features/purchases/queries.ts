import { useQuery } from '@tanstack/react-query';

import { purchasesService } from '@/features/purchases/services/purchases.service';
import { qk } from '@/features/queries';

/**
 * Posted purchases of one day for the day summary bar. The web has no purchases summary
 * endpoint and totals the day's rows client-side (first 100), so this mirrors that.
 */
export const usePurchasesDay = (date: string) =>
  useQuery({
    queryKey: [...qk.purchases, 'day', date],
    queryFn: () => purchasesService.list({ limit: 100, offset: 0, status: 'posted', date_from: date, date_to: date, sort: '-purchased_at' }),
    enabled: Boolean(date),
  });
