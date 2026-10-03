import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { isApiError, isPlanBlocked } from '@/api/errors';
import { useApiErrorMessage, useToast } from '@/components/feedback/toast';
import { useLocale } from '@/lib/i18n/provider';

/**
 * Standard write: runs the call, invalidates the given query prefixes, and shows a toast.
 * Validation errors are left to the form (returned via `error.fieldErrors()`), everything else toasts.
 */
export function useApiMutation<TVars, TData>({
  key,
  fn,
  invalidate = [],
  success,
  onSuccess,
  toastValidation = false,
}: {
  key: string;
  fn: (vars: TVars) => Promise<TData>;
  invalidate?: QueryKey[];
  /** Success toast title (translated); omit for silent success. */
  success?: string | ((data: TData) => string);
  onSuccess?: (data: TData, vars: TVars) => void;
  /** Toast VALIDATION_ERROR too (for actions without a form). */
  toastValidation?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const { t } = useLocale();
  return useMutation({
    mutationKey: [key],
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      if (success) toast.success(typeof success === 'function' ? success(data) : success);
      onSuccess?.(data, vars);
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'VALIDATION_ERROR' && !toastValidation && error.details.some((d) => d.field)) return;
      // Network/5xx are already toasted globally by the API event bus.
      if (isApiError(error) && (error.isNetwork || error.status >= 500)) return;
      // Plan limits and read-only mode get the shared dialog (LimitReachedHost), not a toast.
      if (isPlanBlocked(error)) return;
      toast.error(t('common.error_generic'), toMessage(error));
    },
  });
}

/** Field errors from a failed mutation, for inline form messages. */
export function fieldErrors(error: unknown): Record<string, string> {
  return isApiError(error) ? error.fieldErrors() : {};
}
