import { useQuery } from '@tanstack/react-query';

import { useToast } from '@/components/feedback/toast';
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
