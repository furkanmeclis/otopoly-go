import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { catalogService } from '@/features/catalog/services/catalog.service';
import { qk } from '@/features/queries';

/** Active products for the sale / purchase line pickers (web AsyncCombobox `loadProducts`). */
export const useProductSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: [...qk.catalog, 'products', 'picker', q],
    queryFn: () => catalogService.listProducts({ limit: 20, offset: 0, q: q.trim() || undefined, is_active: 'true', sort: 'name' }),
    enabled,
    placeholderData: keepPreviousData,
  });
