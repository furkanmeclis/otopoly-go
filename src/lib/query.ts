import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/api/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('query');

/** Never retry what a retry can't fix (auth, permission, validation, missing). */
function shouldRetry(failureCount: number, error: unknown) {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => log.warn('Query failed', { key: query.queryKey, error: isApiError(error) ? error.code : String(error) }),
    }),
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, mutation) => log.info('Mutation succeeded', { key: mutation.options.mutationKey }),
      onError: (error, _vars, _ctx, mutation) =>
        log.warn('Mutation failed', {
          key: mutation.options.mutationKey,
          code: isApiError(error) ? error.code : undefined,
          message: (error as Error)?.message,
        }),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
