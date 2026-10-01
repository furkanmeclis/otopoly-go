/**
 * Mounted once inside the signed-in app (`(app)/_layout`):
 *  - registers this device for push (after a short in-app explanation the first time),
 *  - re-registers when the Expo token rotates,
 *  - refreshes the unread badge on foreground pushes and when the app comes back to the foreground,
 *  - replays a link that arrived while the user was signed out / picking an organization.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { BellRing, CalendarClock, FileText, Gauge } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { Button, Row, Sheet, Txt } from '@/components/ui';
import { accountKeys } from '@/features/account/queries';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';
import { useTheme } from '@/theme/provider';

import { linkHref } from '../deep-links';
import { takePendingLink } from '../pending-link';
import { enablePush, getPushPermission, notificationsModule, pushAvailable, registerPushDevice } from '../push';
import { notificationKeys } from '../queries';

const log = createLogger('notifications.host');

/** Delay before the explanation sheet so it doesn't cover the first frame after sign-in. */
const PROMPT_DELAY_MS = 1500;

export function NotificationsHost() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const userUuid = me?.user.uuid;
  const [explain, setExplain] = useState(false);

  // Replay a deferred deep link once we're inside an organization.
  useEffect(() => {
    const pending = takePendingLink();
    if (pending) {
      log.info('Replaying pending link');
      router.push(linkHref(pending));
    }
  }, []);

  // Push registration (or the explanation sheet the first time).
  useEffect(() => {
    if (!userUuid || !pushAvailable()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const permission = await getPushPermission();
      if (cancelled) return;
      if (permission === 'granted') {
        const res = await registerPushDevice();
        if (res === 'registered') qc.invalidateQueries({ queryKey: accountKeys.prefs });
        return;
      }
      if (permission !== 'undetermined') return;
      const key = `${StorageKeys.pushPrompted}.${userUuid}`;
      if (await prefs.get(key, false)) return;
      timer = setTimeout(() => !cancelled && setExplain(true), PROMPT_DELAY_MS);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userUuid, qc]);

  // Token rotation, foreground pushes, app resume.
  useEffect(() => {
    const N = notificationsModule();
    const subs: { remove: () => void }[] = [];
    if (N) {
      if (pushAvailable()) subs.push(N.addPushTokenListener(() => void registerPushDevice()));
      subs.push(
        N.addNotificationReceivedListener(() => {
          void qc.invalidateQueries({ queryKey: notificationKeys.all });
        }),
      );
    }
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void qc.invalidateQueries({ queryKey: notificationKeys.unread });
    });
    return () => {
      subs.forEach((s) => s.remove());
      appState.remove();
    };
  }, [qc]);

  const close = () => {
    setExplain(false);
    if (userUuid) void prefs.set(`${StorageKeys.pushPrompted}.${userUuid}`, true);
  };

  return <PushExplainSheet visible={explain} onClose={close} onDone={() => qc.invalidateQueries({ queryKey: accountKeys.prefs })} />;
}

function PushExplainSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const allow = async () => {
    setBusy(true);
    const res = await enablePush();
    if (!mounted.current) return;
    setBusy(false);
    onClose();
    if (res === 'registered') {
      toast.success(tr('mobile.notifications.push.enabled'));
      onDone();
    } else if (res === 'denied') {
      toast.info(tr('mobile.notifications.push.denied'));
    } else if (res === 'failed') {
      toast.error(tr('mobile.notifications.push.failed'));
    }
  };

  const point = (icon: ReactNode, text: string) => (
    <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <Txt style={{ flex: 1 }}>{text}</Txt>
    </Row>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('mobile.notifications.push.explain_title')}
      footer={
        <>
          <Button label={tr('mobile.notifications.push.allow')} loading={busy} onPress={allow} icon={<BellRing size={18} color={t.colors.onPrimary} />} />
          <Button label={tr('mobile.notifications.push.later')} variant="ghost" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <Txt tone="secondary">{tr('mobile.notifications.push.explain_body')}</Txt>
      {point(<FileText size={16} color={t.colors.primary} />, tr('mobile.notifications.push.point_quotes'))}
      {point(<CalendarClock size={16} color={t.colors.primary} />, tr('mobile.notifications.push.point_todos'))}
      {point(<Gauge size={16} color={t.colors.primary} />, tr('mobile.notifications.push.point_usage'))}
      <Txt variant="caption" tone="muted">
        {tr('mobile.notifications.push.explain_footnote')}
      </Txt>
    </Sheet>
  );
}
