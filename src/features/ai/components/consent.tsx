import { router } from 'expo-router';
import { Ban, Database, MessageSquareText, ShieldCheck, Sparkles, Undo2 } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Card, Row, Txt } from '@/components/ui';
import { providerLabelKey } from '@/features/ai/consent';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Provider name for the disclosure: known kinds are translated, anything else is shown as sent. */
export function useProviderName(provider: string | null | undefined) {
  const { t: tr } = useLocale();
  const key = providerLabelKey(provider);
  return key ? tr(key) : provider || tr('mobile.ai.consent.provider_unknown');
}

function Point({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  const t = useTheme();
  return (
    <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{title}</Txt>
        <Txt variant="caption" tone="secondary">
          {body}
        </Txt>
      </View>
    </Row>
  );
}

/**
 * First-use disclosure for the assistant (App Store 5.1.2(i)): which provider receives data, what is
 * sent, what isn't, and how to withdraw. Nothing is sent until the user taps "I agree".
 */
export function AIConsentGate({ provider, onAccept }: { provider: string | null | undefined; onAccept: () => Promise<unknown> }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const name = useProviderName(provider);
  const [saving, setSaving] = useState(false);
  const accept = async () => {
    setSaving(true);
    try {
      await onAccept();
    } finally {
      setSaving(false);
    }
  };
  const ic = (Icon: typeof Sparkles) => <Icon size={16} color={t.colors.primary} />;
  return (
    <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
      <View style={{ alignItems: 'center', gap: t.spacing.sm, paddingTop: t.spacing.md }}>
        <View style={{ width: 52, height: 52, borderRadius: t.radius.lg, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <ShieldCheck size={26} color={t.colors.primary} />
        </View>
        <Txt variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {tr('mobile.ai.consent.title')}
        </Txt>
        <Txt tone="secondary" style={{ textAlign: 'center' }}>
          {tr('mobile.ai.consent.intro')}
        </Txt>
      </View>
      <Card style={{ gap: t.spacing.lg }}>
        <Point icon={ic(Sparkles)} title={tr('mobile.ai.consent.provider_title')} body={tr('mobile.ai.consent.provider_body', { provider: name })} />
        <Point icon={ic(MessageSquareText)} title={tr('mobile.ai.consent.sent_title')} body={tr('mobile.ai.consent.sent_body')} />
        <Point icon={ic(Database)} title={tr('mobile.ai.consent.records_title')} body={tr('mobile.ai.consent.records_body')} />
        <Point icon={ic(Ban)} title={tr('mobile.ai.consent.not_sent_title')} body={tr('mobile.ai.consent.not_sent_body')} />
        <Point icon={ic(Undo2)} title={tr('mobile.ai.consent.control_title')} body={tr('mobile.ai.consent.control_body')} />
      </Card>
      <Txt variant="caption" tone="muted">
        {tr('mobile.ai.consent.footnote')}
      </Txt>
      <View style={{ gap: t.spacing.sm }}>
        <Button label={tr('mobile.ai.consent.accept')} size="lg" loading={saving} onPress={() => void accept()} />
        <Button label={tr('mobile.ai.consent.decline')} variant="ghost" disabled={saving} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </ScrollView>
  );
}
