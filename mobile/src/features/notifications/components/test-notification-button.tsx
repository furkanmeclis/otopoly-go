/**
 * Demo only (diagnostics, mock mode): creates an inbox notification and, where the native module is
 * available, shows it as a local notification a few seconds later with the same payload a real push
 * carries, so tapping it walks the same path (cold / warm start → link screen → screen).
 */
import { useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react-native';
import { useState } from 'react';

import { useToast } from '@/components/feedback/toast';
import { Button } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { notificationsModule } from '../push';
import { notificationKeys } from '../queries';
import { notificationsService } from '../services/notifications.service';

const log = createLogger('notifications.test');
const DELAY_SECONDS = 5;

export function TestNotificationButton() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const res = await notificationsService.sendTest();
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
      const n = res.items[0];
      const N = notificationsModule();
      let scheduled = false;
      if (N && n) {
        const perm = await N.getPermissionsAsync();
        const granted = perm.granted || (await N.requestPermissionsAsync()).granted;
        if (granted) {
          await N.scheduleNotificationAsync({
            content: {
              title: n.title,
              body: n.body,
              data: { url: n.action_url, notification_uuid: n.uuid, kind: n.template_code },
            },
            trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: DELAY_SECONDS },
          });
          scheduled = true;
        }
      }
      toast.success(tr('mobile.notifications.test.sent'), scheduled ? tr('mobile.notifications.test.scheduled', { seconds: DELAY_SECONDS }) : undefined);
    } catch (error) {
      log.warn('Test notification failed', error);
      toast.error(tr('notifications.toast.action_failed'));
    } finally {
      setBusy(false);
    }
  };

  return <Button size="sm" variant="ghost" label={tr('mobile.notifications.test.button')} loading={busy} icon={<BellRing size={16} color={t.colors.primary} />} onPress={send} />;
}
