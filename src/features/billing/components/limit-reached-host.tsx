import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { isLimitReached, isReadOnly, limitInfo } from '@/api/errors';
import { subscribeApiEvents } from '@/api/events';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { limitReachedMessage, readOnlyMessageKey } from '@/features/billing/lib';
import { billingKeys } from '@/features/billing/queries';
import type { BillingOverview } from '@/features/billing/types';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('plan.limit');

/**
 * App-wide `409 LIMIT_REACHED` dialog (mounted once in the signed-in layout). Any write that hits a
 * plan limit — job, customer, staff, quote → job, … — lands here through the API error bus, so
 * screens need no limit handling of their own (`useApiMutation` skips its error toast for it).
 *
 * `403 SUBSCRIPTION_READ_ONLY` (plan period ended, writes refused) uses the same dialog with its own
 * neutral copy, so every plan block looks the same wherever it happens.
 *
 * Copy depends on the membership role and on `owner_notified`: when the API reports the owner was
 * notified, the owner is told the details were e-mailed and staff that the manager was informed;
 * otherwise a neutral variant claims neither. Only "Close" and, with `tenant.billing.read`,
 * "View usage". Nothing to buy.
 */
export function LimitReachedHost() {
  const qc = useQueryClient();
  const { t, fmt } = useLocale();
  const { isOwner, can } = useAuth();
  const canSeeUsage = can(P.billingRead);
  const open = useRef(false);

  useEffect(
    () =>
      subscribeApiEvents((error) => {
        const readOnly = isReadOnly(error);
        if (!readOnly && !isLimitReached(error)) return;
        void qc.invalidateQueries({ queryKey: billingKeys.overview });
        if (open.current) return;
        open.current = true;

        let title: string;
        let message: string;
        if (readOnly) {
          log.warn('Write refused: subscription is read-only');
          title = t('mobile.plan.read_only_dialog.title');
          message = t(readOnlyMessageKey(isOwner));
        } else {
          const info = limitInfo(error);
          log.warn('Plan limit reached', info);
          const meter = qc.getQueryData<BillingOverview>(billingKeys.overview)?.meters.find((m) => m.key === info.feature);
          title = t('mobile.plan.limit.title');
          message = limitReachedMessage(t, { isOwner, ...info, meterPeriod: meter?.period, formatNumber: (n) => fmt.number(n) });
        }
        const close = () => {
          open.current = false;
        };
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert(
          title,
          message,
          [
            ...(canSeeUsage
              ? [
                  {
                    text: t('mobile.plan.limit.view_usage'),
                    onPress: () => {
                      close();
                      router.push('/settings/usage');
                    },
                  },
                ]
              : []),
            { text: t('common.close'), style: 'cancel' as const, onPress: close },
          ],
          { cancelable: true, onDismiss: close },
        );
      }),
    [qc, t, fmt, isOwner, canSeeUsage],
  );

  return null;
}
