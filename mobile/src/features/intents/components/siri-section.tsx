import { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { Button, Card, Divider, Section, SwitchRow, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { deleteAllDonations, intentsAvailable, loadShareCustomers, openShortcutsApp, setShareCustomers, subscribeShareCustomers } from '../bridge';
import { availableShortcuts } from '../catalog';
import type { ShortcutName } from '../routing';

/**
 * Preferences → "Siri ve Kısayollar": the phrases this member can use, the customer-name sharing switch,
 * a link to the Shortcuts app and a way to clear Siri suggestions. iOS only.
 */
export function SiriShortcutsSection() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const toast = useToast();
  const available = intentsAvailable();
  const [share, setShare] = useState<boolean | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    loadShareCustomers().then((v) => alive && setShare(v));
    const off = subscribeShareCustomers(setShare);
    return () => {
      alive = false;
      off();
    };
  }, [available]);

  const text = useMemo<Record<ShortcutName, { title: string; phrase: string; hint: string }>>(
    () => ({
      todaySummary: { title: tr('mobile.intents.shortcut.todaySummary.title'), phrase: tr('mobile.intents.shortcut.todaySummary.phrase'), hint: tr('mobile.intents.shortcut.todaySummary.hint') },
      newJob: { title: tr('mobile.intents.shortcut.newJob.title'), phrase: tr('mobile.intents.shortcut.newJob.phrase'), hint: tr('mobile.intents.shortcut.newJob.hint') },
      searchPlate: { title: tr('mobile.intents.shortcut.searchPlate.title'), phrase: tr('mobile.intents.shortcut.searchPlate.phrase'), hint: tr('mobile.intents.shortcut.searchPlate.hint') },
      openCustomer: { title: tr('mobile.intents.shortcut.openCustomer.title'), phrase: tr('mobile.intents.shortcut.openCustomer.phrase'), hint: tr('mobile.intents.shortcut.openCustomer.hint') },
      readyJobs: { title: tr('mobile.intents.shortcut.readyJobs.title'), phrase: tr('mobile.intents.shortcut.readyJobs.phrase'), hint: tr('mobile.intents.shortcut.readyJobs.hint') },
      askAssistant: { title: tr('mobile.intents.shortcut.askAssistant.title'), phrase: tr('mobile.intents.shortcut.askAssistant.phrase'), hint: tr('mobile.intents.shortcut.askAssistant.hint') },
      qrLogin: { title: tr('mobile.intents.shortcut.qrLogin.title'), phrase: tr('mobile.intents.shortcut.qrLogin.phrase'), hint: tr('mobile.intents.shortcut.qrLogin.hint') },
      calendarToday: { title: tr('mobile.intents.shortcut.calendarToday.title'), phrase: tr('mobile.intents.shortcut.calendarToday.phrase'), hint: tr('mobile.intents.shortcut.calendarToday.hint') },
    }),
    [tr],
  );

  if (Platform.OS !== 'ios') return null;

  if (!available) {
    return (
      <Section title={tr('mobile.intents.title')}>
        <Card>
          <Txt variant="caption" tone="secondary">
            {tr('mobile.intents.unavailable')}
          </Txt>
        </Card>
      </Section>
    );
  }

  const shortcuts = availableShortcuts(can);
  const canShareCustomers = can(P.customersRead) && can(P.jobsRead);

  const clear = async () => {
    setClearing(true);
    try {
      await deleteAllDonations();
      toast.success(tr('mobile.intents.cleared'));
    } finally {
      setClearing(false);
    }
  };

  return (
    <Section title={tr('mobile.intents.title')}>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.intents.description')}
      </Txt>
      <Card style={{ gap: t.spacing.md }}>
        <Txt variant="bodyStrong">{tr('mobile.intents.phrases_title')}</Txt>
        {shortcuts.length === 0 ? (
          <Txt variant="caption" tone="secondary">
            {tr('mobile.intents.phrases_empty')}
          </Txt>
        ) : (
          shortcuts.map((name, i) => (
            <View key={name} style={{ gap: 2 }} accessible accessibilityLabel={`${text[name].title}. ${text[name].phrase}. ${text[name].hint}`}>
              {i > 0 ? <Divider style={{ marginBottom: t.spacing.sm }} /> : null}
              <Txt variant="label" tone="secondary">
                {text[name].title}
              </Txt>
              <Txt variant="bodyStrong" style={{ flexShrink: 1 }}>
                {text[name].phrase}
              </Txt>
              <Txt variant="caption" tone="muted" style={{ flexShrink: 1 }}>
                {text[name].hint}
              </Txt>
            </View>
          ))
        )}
      </Card>
      <Card style={{ gap: t.spacing.md }}>
        {canShareCustomers ? (
          <SwitchRow
            label={tr('mobile.intents.share_customers')}
            description={tr('mobile.intents.share_customers_hint')}
            value={share ?? true}
            disabled={share === null}
            onValueChange={setShareCustomers}
          />
        ) : null}
        <Txt variant="caption" tone="secondary">
          {tr('mobile.intents.privacy')}
        </Txt>
        <Button
          label={tr('mobile.intents.open_shortcuts')}
          variant="outline"
          onPress={async () => {
            if (!(await openShortcutsApp())) toast.error(tr('mobile.intents.open_failed'));
          }}
        />
        <Button label={tr('mobile.intents.clear')} variant="ghost" loading={clearing} onPress={() => void clear()} />
      </Card>
    </Section>
  );
}
