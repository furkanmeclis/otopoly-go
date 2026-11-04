/** Catalog-area hooks not covered by the shared `features/queries.ts`. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { catalogService } from '@/features/catalog/services/catalog.service';
import { qk } from '@/features/queries';

export type CategoryListParams = { kind?: 'product' | 'service'; is_active?: string; q?: string };

export const useCategoryList = (params: CategoryListParams) =>
  useQuery({
    queryKey: [...qk.catalog, 'categories', 'list', params],
    queryFn: () => catalogService.listCategories(params),
    placeholderData: keepPreviousData,
  });

/** Active categories of one kind, for form pickers (web dialogs load `is_active=true`). */
export const useActiveCategories = (kind?: 'product' | 'service') =>
  useQuery({
    queryKey: [...qk.catalog, 'categories', 'active', kind],
    queryFn: () => catalogService.listCategories({ kind, is_active: 'true' }),
    staleTime: 60_000,
  });

export const useCategory = (uuid: string) =>
  useQuery({ queryKey: [...qk.catalog, 'category', uuid], queryFn: () => catalogService.getCategory(uuid), enabled: Boolean(uuid) });

/** Active products for pickers (web `loadProductOptions`: 20 by name, `q` search). */
export const useProductSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: [...qk.catalog, 'products', 'search', q],
    queryFn: () => catalogService.listProducts({ limit: 20, offset: 0, q: q.trim() || undefined, is_active: 'true', sort: 'name' }),
    enabled,
    placeholderData: keepPreviousData,
  });
