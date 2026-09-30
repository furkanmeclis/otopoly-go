import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { qk } from '@/features/queries';
import { suppliersService } from '@/features/suppliers/services/suppliers.service';

/** Active suppliers for the purchase supplier picker (web `loadSuppliers`). */
export const useSupplierSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: [...qk.suppliers, 'search', q],
    queryFn: () => suppliersService.list({ limit: 20, offset: 0, q: q.trim() || undefined, is_active: 'true' }),
    enabled,
    placeholderData: keepPreviousData,
  });
