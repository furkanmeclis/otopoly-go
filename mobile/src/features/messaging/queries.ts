import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useApiErrorMessage, useToast } from '@/components/feedback/toast';
import { smsErrorLabel } from '@/features/messaging/lib/send-errors';
import { smsService, type SaveSmsProviderInput, type SmsProviderCode } from '@/features/messaging/services/sms.service';
import { dailySummaryService } from '@/features/messaging/services/daily-summary.service';
import { messagingService } from '@/features/messaging/services/messaging.service';
import { templatesService, type SaveMessageTemplateInput, type TemplateKey } from '@/features/messaging/services/templates.service';
import { vehicleAlertsService } from '@/features/messaging/services/vehicle-alerts.service';
import type { SimulateInput } from '@/features/messaging/types';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';

/** `['messaging','session']` is shared with the dashboard setup checklist — keep it. */
export const messagingKeys = {
  session: [...qk.messaging, 'session'] as const,
  rules: [...qk.messaging, 'rules'] as const,
  catalog: [...qk.messaging, 'catalog'] as const,
  dailySummary: [...qk.messaging, 'daily-summary'] as const,
  vehicleAlerts: [...qk.messaging, 'vehicle-alerts'] as const,
  sms: [...qk.messaging, 'sms'] as const,
};

/** Polls every 1.5 s while a QR is waiting to be scanned (web `pollWhilePairing`). */
export function useWhatsAppSession() {
  return useQuery({
    queryKey: messagingKeys.session,
    queryFn: () => messagingService.getSession(),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'qr_pending' ? 1500 : false),
  });
}

export const useNotificationRules = () => useQuery({ queryKey: messagingKeys.rules, queryFn: () => messagingService.listRules() });
export const useTemplateCatalog = () => useQuery({ queryKey: messagingKeys.catalog, queryFn: () => templatesService.catalog() });
export const useDailySummary = (enabled: boolean) => useQuery({ queryKey: messagingKeys.dailySummary, queryFn: dailySummaryService.get, enabled });
export const useVehicleAlerts = (enabled: boolean) => useQuery({ queryKey: messagingKeys.vehicleAlerts, queryFn: vehicleAlertsService.get, enabled });

export function useConnectWhatsApp() {
  return useApiMutation({ key: 'messaging.connect', fn: () => messagingService.connectWhatsApp(), invalidate: [messagingKeys.session, messagingKeys.dailySummary, messagingKeys.vehicleAlerts], toastValidation: true });
}

export function useUpdateSessionSettings() {
  const { t } = useLocale();
  const qc = useQueryClient();
  return useApiMutation({
    key: 'messaging.session.settings',
    fn: (fallbackToPlatform: boolean) => messagingService.updateSessionSettings({ fallback_to_platform: fallbackToPlatform }),
    invalidate: [messagingKeys.session],
    success: t('messaging.toast.session_settings_saved'),
    onSuccess: (data) => {
      qc.setQueryData(messagingKeys.session, data);
    },
    toastValidation: true,
  });
}

export function useDisconnectWhatsApp() {
  const { t } = useLocale();
  return useApiMutation({
    key: 'messaging.disconnect',
    fn: () => messagingService.disconnectWhatsApp(),
    invalidate: [messagingKeys.session, messagingKeys.dailySummary, messagingKeys.vehicleAlerts],
    success: t('messaging.toast.disconnected'),
  });
}

export function useToggleRule() {
  return useApiMutation({
    key: 'messaging.rule',
    fn: ({ eventType, channel, enabled }: { eventType: string; channel: string; enabled: boolean }) => messagingService.toggleRule(eventType, channel, enabled),
    invalidate: [messagingKeys.rules],
    toastValidation: true,
  });
}

/** Test sends; toasts "N sent" or "N sent, M failed" like the web hook. */
export function useSimulateMessaging() {
  const { t } = useLocale();
  const toast = useToast();
  return useApiMutation({
    key: 'messaging.simulate',
    fn: (body: SimulateInput) => messagingService.simulate(body),
    toastValidation: true,
    onSuccess: (result) => {
      const failed = result.items.filter((i) => i.status !== 'sent').length;
      const sent = result.items.length - failed;
      if (failed === 0) toast.success(t('messaging.toast.simulate_sent', { sent }));
      else toast.error(t('messaging.toast.simulate_partial', { sent, failed }));
    },
  });
}

export function useTemplateMutations() {
  const { t } = useLocale();
  const save = useApiMutation({
    key: 'messaging.template.save',
    fn: ({ key, body }: { key: TemplateKey; body: SaveMessageTemplateInput }) => templatesService.save(key, body),
    invalidate: [messagingKeys.catalog],
    success: t('messaging.editor.saved'),
    toastValidation: true,
  });
  const reset = useApiMutation({
    key: 'messaging.template.reset',
    fn: (key: TemplateKey) => templatesService.reset(key),
    invalidate: [messagingKeys.catalog],
    success: t('messaging.editor.reset_done'),
  });
  return { save, reset };
}

// ─── SMS channels (Kanallar) ─────────────────────────────────────────────────

export const useSmsChannel = (enabled = true) => useQuery({ queryKey: messagingKeys.sms, queryFn: () => smsService.overview(), enabled });

/** Channel availability feeds the daily summary / vehicle alerts cards too. */
const SMS_INVALIDATE = [messagingKeys.sms, messagingKeys.dailySummary, messagingKeys.vehicleAlerts];

export function useSmsMutations() {
  const { t } = useLocale();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const reason = (code?: string, message?: string) => smsErrorLabel(t, code) || message || '';
  return {
    save: useApiMutation({
      key: 'messaging.sms.save',
      fn: ({ provider, body }: { provider: SmsProviderCode; body: SaveSmsProviderInput }) => smsService.save(provider, body),
      invalidate: SMS_INVALIDATE,
      success: t('mobile.messaging.sms.toast.saved'),
      toastValidation: true,
    }),
    setActive: useApiMutation({
      key: 'messaging.sms.active',
      fn: ({ provider, isActive }: { provider: SmsProviderCode; isActive: boolean }) => smsService.setActive(provider, isActive),
      invalidate: SMS_INVALIDATE,
      success: (account) => (account.is_active ? t('mobile.messaging.sms.toast.enabled') : t('mobile.messaging.sms.toast.disabled')),
      toastValidation: true,
    }),
    disconnect: useApiMutation({
      key: 'messaging.sms.disconnect',
      fn: (provider: SmsProviderCode) => smsService.disconnect(provider),
      invalidate: SMS_INVALIDATE,
      success: t('mobile.messaging.sms.toast.disconnected'),
      toastValidation: true,
    }),
    /** Connection check; the result (balance, approved headers or the reason) is shown by the caller. */
    test: useMutation({
      mutationKey: ['messaging.sms.test'],
      mutationFn: (provider: SmsProviderCode) => smsService.test(provider),
      onSuccess: () => void Promise.all(SMS_INVALIDATE.map((k) => qc.invalidateQueries({ queryKey: k }))),
      onError: (error) => toast.error(t('mobile.messaging.sms.toast.test_error'), toMessage(error)),
    }),
    sendTest: useApiMutation({
      key: 'messaging.sms.test_sms',
      fn: ({ provider, phone, body }: { provider: SmsProviderCode; phone: string; body: string }) => smsService.sendTest(provider, { phone, body }),
      onSuccess: (res) => {
        if (res.status === 'sent') toast.success(t('mobile.messaging.sms.toast.test_sms_sent', { recipient: res.recipient }));
        else toast.error(t('mobile.messaging.sms.toast.test_sms_failed', { reason: reason(res.error_code, res.error_message) }));
      },
    }),
    reason,
  };
}

/** Value that settles `delayMs` after the last change (live counters). */
export function useDebounced<T>(value: T, delayMs = 400) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

/** Live segment estimate from the API (`POST …/sms/estimate`), debounced while typing. */
export function useSmsEstimate(body: string, provider?: SmsProviderCode) {
  const settled = useDebounced(body, 400);
  const query = useQuery({
    queryKey: [...messagingKeys.sms, 'estimate', provider ?? '', settled],
    queryFn: () => smsService.estimate(settled, provider),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  return { ...query, pending: settled !== body || query.isFetching };
}
