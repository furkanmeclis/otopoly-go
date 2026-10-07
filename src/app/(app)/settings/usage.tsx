import { useQueryClient } from '@tanstack/react-query';
import { Check, Gauge, Info, Minus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Card, EmptyState, ErrorState, Group, InfoRow, ListSkeleton, Row, Screen, Header, Section, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { UsageMeter } from '@/features/billing/components/usage-meter';
import { meterLabel, STATUS_TONE } from '@/features/billing/lib';
import { useBillingOverview } from '@/features/billing/queries';
import type { BillingOverview, BillingUsageMeter } from '@/features/billing/types';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/**
 * "Kullanım ve limitler": the organization's plan and usage, read-only.
 *
 * Product rule (App Store 3.1.1 / 3.1.3, Google Play payments policy): the app shows no prices,
 * purchase or upgrade actions, invoices or payment details, and links to nothing that sells.
 * When a limit is hit the backend e-mails the owner.
 */
export default function UsageScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.billingRead} title={tr('mobile.plan.title')}>
      <Usage />
    </RequirePermission>
  );
}

function Usage() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const overview = useBillingOverview(true);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: qk.billing });
    setRefreshing(false);
  };
  const data = overview.data;

  return (
    <Screen header={<Header title={tr('mobile.plan.title')} subtitle={tr('mobile.plan.subtitle')} />} refreshing={refreshing} onRefresh={() => void refresh()}>
      {overview.isLoading ? (
        <ListSkeleton rows={4} height={88} />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : !data?.subscription ? (
        <EmptyState icon={<Gauge size={28} color={t.colors.textMuted} />} title={tr('mobile.plan.no_plan')} />
      ) : (
        <>
          <PlanCard overview={data} />
          <UsageSection meters={data.meters} />
          <IncludedSection meters={data.meters} />
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
            <Info size={14} color={t.colors.textMuted} style={{ marginTop: 2 }} />
            <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
              {tr('mobile.plan.info_note')}
            </Txt>
          </Row>
        </>
      )}
    </Screen>
  );
}

function PlanCard({ overview }: { overview: BillingOverview }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const sub = overview.subscription!;
  const ended = sub.days_left <= 0;
  return (
    <Section title={tr('mobile.plan.current_plan')}>
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.sm} wrap>
          <Txt variant="title" style={{ flexShrink: 1 }}>
            {sub.plan_name}
          </Txt>
          <Badge tone={STATUS_TONE[sub.status] ?? 'neutral'} label={tr(`billing.status.${sub.status}`)} />
        </Row>
        {overview.plan?.description ? (
          <Txt variant="caption" tone="secondary">
            {overview.plan.description}
          </Txt>
        ) : null}
        <Group>
          <InfoRow label={tr('mobile.plan.period_end')} last>
            <Txt tone={ended ? 'danger' : 'default'}>
              {fmt.date(sub.ends_at, 'short')} · {ended ? tr('billing.expired') : tr('billing.days_left', { days: sub.days_left })}
            </Txt>
          </InfoRow>
        </Group>
        {overview.read_only ? (
          <Txt variant="caption" tone="danger">
            {tr('mobile.plan.read_only')}
          </Txt>
        ) : null}
      </Card>
    </Section>
  );
}

function UsageSection({ meters }: { meters: BillingUsageMeter[] }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const limits = meters.filter((m) => m.kind === 'limit');
  return (
    <Section title={tr('mobile.plan.usage_section')}>
      <Card style={{ gap: t.spacing.lg }}>
        {limits.length === 0 ? (
          <Txt variant="caption" tone="secondary">
            {tr('mobile.plan.usage_empty')}
          </Txt>
        ) : (
          limits.map((m) => <UsageMeter key={m.key} meter={m} />)
        )}
      </Card>
    </Section>
  );
}

function IncludedSection({ meters }: { meters: BillingUsageMeter[] }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const toggles = meters.filter((m) => m.kind === 'toggle');
  if (!toggles.length) return null;
  return (
    <Section title={tr('mobile.plan.included_section')}>
      <Card padded={false}>
        {toggles.map((m, i) => {
          const on = m.enabled !== false;
          return (
            <View key={m.key} style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.border }}>
              <Row gap={t.spacing.md} style={{ justifyContent: 'space-between' }}>
                <Txt style={{ flex: 1 }}>{meterLabel(m, locale)}</Txt>
                <Badge
                  size="sm"
                  tone={on ? 'success' : 'neutral'}
                  icon={on ? <Check size={11} color={t.colors.success} /> : <Minus size={11} color={t.colors.neutral} />}
                  label={on ? tr('mobile.plan.included') : tr('mobile.plan.not_included')}
                />
              </Row>
            </View>
          );
        })}
      </Card>
    </Section>
  );
}
