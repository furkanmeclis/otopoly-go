/** Subscription — web `/t/[slug]/loyalty/subscriptions/[uuid]`: current period usage, renewal, payments, usage, collect and cancel. */
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Banknote, MessageCircle, Phone, Repeat } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DetailHero,
  ErrorState,
  Group,
  Header,
  InfoRow,
  LinkValue,
  ListRow,
  ListSkeleton,
  QuickActions,
  RelatedSection,
  Screen,
  Section,
  StatGrid,
  Txt,
  useConfirm,
  usePullRefresh,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { useLiveResource } from '@/features/live/use-live-resource';
import { PaySubscriptionSheet } from '@/features/loyalty/components/sale-sheets';
import { dayDate, planUsesLabel, renewalLabel, SUBSCRIPTION_STATE_TONE } from '@/features/loyalty/lib/labels';
import { useLoyaltyAccess, useLoyaltyMutations, useSubscription } from '@/features/loyalty/queries';
import { contact } from '@/lib/contact';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function SubscriptionScreen() {
  useLiveResource(['tenant.loyalty.subscriptions', 'tenant.loyalty.customers']);
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.loyaltyRead} title={tr('loyalty.subscriptions.detail')}>
      <SubscriptionDetail />
    </RequirePermission>
  );
}

function SubscriptionDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const access = useLoyaltyAccess();
  const confirm = useConfirm();
  const q = useSubscription(id);
  const pull = usePullRefresh(q);
  const { cancelSubscription } = useLoyaltyMutations();
  const [payOpen, setPayOpen] = useState(false);
  const s = q.data;

  if (q.isLoading) {
    return (
      <Screen header={<Header title={tr('loyalty.subscriptions.detail')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (q.isError || !s) {
    return (
      <Screen header={<Header title={tr('loyalty.subscriptions.detail')} />}>
        <ErrorState error={q.error} description={tr('loyalty.errors.detail')} onRetry={() => q.refetch()} />
      </Screen>
    );
  }

  const period = s.current_period;
  const phone = s.customer_phone?.trim();
  const cancel = async () => {
    if (await confirm({ title: tr('loyalty.subscriptions.cancel_title'), message: tr('loyalty.subscriptions.cancel_description'), destructive: true, confirmLabel: tr('loyalty.subscriptions.cancel_confirm') }))
      cancelSubscription.mutate(s.uuid);
  };

  return (
    <Screen header={<Header title={s.name} subtitle={tr('loyalty.subscriptions.detail')} />} refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <DetailHero
        leading={<Repeat size={28} color={t.colors.primary} />}
        title={s.customer_name}
        subtitle={[s.name, s.plate].filter(Boolean).join(' · ')}
        badges={<Badge size="sm" tone={SUBSCRIPTION_STATE_TONE[s.state]} label={tr(`loyalty.subscription_state.${s.state}`)} />}
      >
        {phone ? (
          <QuickActions
            actions={[
              { key: 'call', label: tr('mobile.detail.call'), icon: <Phone size={20} color={t.colors.primary} />, onPress: () => contact.call(phone) },
              { key: 'wa', label: tr('mobile.detail.whatsapp'), icon: <MessageCircle size={20} color={t.colors.primary} />, onPress: () => contact.whatsapp(phone) },
            ]}
          />
        ) : null}
      </DetailHero>

      {s.state === 'past_due' ? (
        <Card style={{ borderColor: t.colors.warning }}>
          <Txt tone="warning" variant="caption">
            {tr('loyalty.subscriptions.past_due_hint', { date: fmt.date(dayDate(s.renewal_date)) })}
          </Txt>
        </Card>
      ) : null}

      <StatGrid
        items={[
          {
            label: tr('loyalty.fields.this_period'),
            value: period ? (period.limit ? `${period.used} / ${period.limit}` : String(period.used)) : '—',
            hint: period ? (period.limit ? tr('loyalty.subscriptions.used_of', { used: period.used, limit: period.limit }) : tr('loyalty.subscriptions.used_unlimited', { used: period.used })) : tr('loyalty.subscriptions.no_period'),
          },
          {
            label: tr('loyalty.fields.renewal_date'),
            value: fmt.date(dayDate(s.renewal_date), 'short'),
            hint: s.state === 'cancelled' ? undefined : renewalLabel(tr, s.days_until_renewal),
            tone: s.state === 'past_due' ? 'warning' : 'default',
          },
        ]}
      />

      {access.canApply && s.state !== 'cancelled' ? (
        <Button label={tr('loyalty.pay.title')} icon={<Banknote size={18} color={t.colors.onPrimary} />} onPress={() => setPayOpen(true)} size="lg" />
      ) : null}

      <Section title={tr('loyalty.subscriptions.info')}>
        <Group>
          <View style={{ paddingHorizontal: t.spacing.lg }}>
            <InfoRow label={tr('loyalty.fields.customer')}>
              <LinkValue label={s.customer_name} onPress={can(P.customersRead) ? () => router.push(`/customers/${s.customer_uuid}`) : undefined} />
            </InfoRow>
            <InfoRow label={tr('loyalty.fields.price_per_period')} value={fmt.money(s.price, s.currency)} />
            <InfoRow label={tr('loyalty.fields.period')} value={planUsesLabel(tr, s)} />
            <InfoRow label={tr('loyalty.fields.vehicle')} value={s.plate ?? tr('loyalty.fields.any_vehicle')} />
            <InfoRow label={tr('loyalty.fields.start_date')} value={fmt.date(dayDate(s.start_date))} />
            {period ? <InfoRow label={tr('loyalty.fields.this_period')} value={`${fmt.date(dayDate(period.start), 'short')} – ${fmt.date(dayDate(period.end), 'short')}`} /> : null}
            {s.cancelled_at ? <InfoRow label={tr('loyalty.fields.cancelled_at')} value={fmt.dateTime(s.cancelled_at)} /> : null}
            <InfoRow label={tr('loyalty.fields.notes')} value={s.notes || '—'} last />
          </View>
        </Group>
      </Section>

      <RelatedSection
        title={tr('loyalty.payments.title')}
        items={s.payments}
        empty={tr('loyalty.payments.empty_description')}
        renderItem={(p, i, last) => (
          <ListRow
            key={p.uuid}
            title={`${fmt.date(dayDate(p.period_start), 'short')} – ${fmt.date(dayDate(p.period_end), 'short')}`}
            subtitle={[fmt.dateTime(p.created_at), tr(`loyalty.method.${p.method}`), p.finance_account_name].filter(Boolean).join(' · ')}
            right={<Txt variant="mono">{fmt.money(p.amount, p.currency)}</Txt>}
            chevron={false}
            last={last}
          />
        )}
      />

      <RelatedSection
        title={tr('loyalty.usage.title')}
        items={s.usage}
        empty={tr('loyalty.usage.empty_description')}
        renderItem={(u, i, last) => (
          <ListRow
            key={u.uuid}
            title={`${u.plate} · ${u.line_name}`}
            subtitle={`${fmt.dateTime(u.created_at)} · −${fmt.money(u.discount_amount, s.currency)}`}
            right={<Badge size="sm" tone={u.status === 'applied' ? 'success' : 'neutral'} label={tr(`loyalty.application_status.${u.status}`)} />}
            onPress={can(P.jobsRead) ? () => router.push(`/jobs/${u.job_uuid}`) : undefined}
            last={last}
          />
        )}
      />

      {access.canWrite && s.state !== 'cancelled' ? (
        <Button variant="outline" label={tr('loyalty.subscriptions.cancel')} icon={<Ban size={16} color={t.colors.danger} />} onPress={cancel} loading={cancelSubscription.isPending} />
      ) : null}

      <PaySubscriptionSheet visible={payOpen} onClose={() => setPayOpen(false)} subscription={s} next={s.next_period} />
    </Screen>
  );
}
