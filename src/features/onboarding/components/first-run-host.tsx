/**
 * Role-aware first-run sheet, mounted once inside the signed-in app (`(app)/_layout`). Shown once per
 * user per organization, only on Home, never while the QA tour runs and not when this launch opened a
 * deferred deep link (it shows next time instead). Whatever happens, it "settles" so the push
 * explanation sheet (NotificationsHost) can follow without two sheets opening together.
 */
import { router, usePathname } from 'expo-router';
import { ClipboardList, QrCode, Sparkles, UserPlus, Wrench } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Sheet, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { firstRunItems, loadFirstRunSeen, markFirstRunSeen, resetFirstRunSettled, settleFirstRun, takeDeepLinkReplayed, type FirstRunItem } from '../state';

const log = createLogger('onboarding.first_run');

/** Lets Home paint before the sheet slides up. */
const SHOW_DELAY_MS = 700;

export function FirstRunHost() {
  const { me, organization, can, isOwner } = useAuth();
  const pathname = usePathname();
  const userUuid = me?.user.uuid;
  const orgSlug = organization?.slug;
  const [visible, setVisible] = useState(false);
  const items = firstRunItems(can);
  const hasItems = items.length > 0;
  const decided = useRef<string | null>(null);
  const linkReplayed = useRef<boolean | null>(null);

  // A fresh organization session: the push sheet waits for this host's decision again. Runs before
  // NotificationsHost's effects (this host is mounted first), which only check after an async step.
  useEffect(() => {
    resetFirstRunSettled();
  }, [orgSlug]);

  useEffect(() => {
    if (!userUuid || !orgSlug) return;
    const id = `${userUuid}:${orgSlug}`;
    if (decided.current === id) return;
    if (!hasItems) {
      decided.current = id;
      settleFirstRun();
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const seen = await loadFirstRunSeen(userUuid, orgSlug);
      if (cancelled) return;
      // Read after the await: NotificationsHost replays a deferred link in its first effect.
      if (linkReplayed.current === null) linkReplayed.current = takeDeepLinkReplayed();
      if (seen || linkReplayed.current) {
        decided.current = id;
        if (!seen) log.info('Skipped: a deep link was opened on entry');
        settleFirstRun();
        return;
      }
      // Only on Home; elsewhere wait (the push sheet's safety timeout covers a user who never goes Home).
      if (pathname !== '/') return;
      decided.current = id;
      timer = setTimeout(() => {
        timer = undefined;
        setVisible(true);
      }, SHOW_DELAY_MS);
    })();
    return () => {
      cancelled = true;
      // Left Home before the sheet appeared: decide again the next time Home shows.
      if (timer) {
        clearTimeout(timer);
        decided.current = null;
      }
    };
  }, [userUuid, orgSlug, pathname, hasItems]);

  const close = (href?: FirstRunItem['href']) => {
    setVisible(false);
    if (userUuid && orgSlug) void markFirstRunSeen(userUuid, orgSlug);
    settleFirstRun();
    if (href) router.push(href);
  };

  if (!hasItems) return null;
  return <FirstRunSheet visible={visible} isOwner={isOwner} orgName={organization?.name ?? ''} items={items} onClose={close} />;
}

function FirstRunSheet({
  visible,
  isOwner,
  orgName,
  items,
  onClose,
}: {
  visible: boolean;
  isOwner: boolean;
  orgName: string;
  items: FirstRunItem[];
  onClose: (href?: FirstRunItem['href']) => void;
}) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const icon = (Icon: typeof Wrench) => <Icon size={18} color={t.colors.primary} />;
  // Literal keys (scripts/check-i18n.mjs can't see template keys).
  const copy: Record<FirstRunItem['key'], { title: string; body: string; icon: ReactNode }> = {
    services: { title: tr('mobile.onboarding.first_run.services_title'), body: tr('mobile.onboarding.first_run.services_body'), icon: icon(Wrench) },
    staff: { title: tr('mobile.onboarding.first_run.staff_title'), body: tr('mobile.onboarding.first_run.staff_body'), icon: icon(UserPlus) },
    jobs: { title: tr('mobile.onboarding.first_run.jobs_title'), body: tr('mobile.onboarding.first_run.jobs_body'), icon: icon(ClipboardList) },
    qr: { title: tr('mobile.onboarding.first_run.qr_title'), body: tr('mobile.onboarding.first_run.qr_body'), icon: icon(QrCode) },
    assistant: { title: tr('mobile.onboarding.first_run.assistant_title'), body: tr('mobile.onboarding.first_run.assistant_body'), icon: icon(Sparkles) },
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => onClose()}
      title={isOwner ? tr('mobile.onboarding.first_run.title_owner') : tr('mobile.onboarding.first_run.title_staff', { org: orgName })}
      footer={<Button label={tr('mobile.onboarding.first_run.done')} onPress={() => onClose()} />}
    >
      <Txt tone="secondary">{isOwner ? tr('mobile.onboarding.first_run.body_owner') : tr('mobile.onboarding.first_run.body_staff')}</Txt>
      <View style={{ gap: t.spacing.sm }}>
        {items.map((item) => {
          const c = copy[item.key];
          return (
            <Pressable
              key={item.key}
              onPress={() => onClose(item.href)}
              accessibilityRole="button"
              accessibilityLabel={`${c.title}. ${c.body}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.md,
                padding: t.spacing.md,
                borderRadius: t.radius.md,
                borderWidth: 1,
                borderColor: t.colors.border,
                backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                minHeight: 56,
              })}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>{c.icon}</View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">{c.title}</Txt>
                <Txt variant="caption" tone="secondary">
                  {c.body}
                </Txt>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
