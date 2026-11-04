/**
 * Finance-screen hooks that the shared `features/queries.ts` does not cover.
 * Keys stay under `qk.finance` so every money mutation (`MONEY_KEYS`) refreshes them.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { financeService } from '@/features/finance/services/finance.service';
import { qk, useInfiniteList } from '@/features/queries';

type Params = Record<string, string | number | undefined>;

/** Paginated accounts list (web accounts table: `q`, `is_active`, `sort`). */
export const useAccountsInfinite = (params: Params) => useInfiniteList([...qk.finance, 'accounts-list'], (p) => financeService.listAccounts(p as never), params);

/** All categories (optionally including inactive) — the endpoint is not paginated. */
export const useAllFinanceCategories = (params: { kind?: 'income' | 'expense'; is_active?: string } = {}) =>
  useQuery({
    queryKey: [...qk.finance, 'categories-all', params],
    queryFn: () => financeService.listCategories(params),
    placeholderData: keepPreviousData,
  });
