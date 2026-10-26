import { router } from 'expo-router';
import { Package, Repeat } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Button, ErrorState, Group, ListRow, Row, Section, Skeleton, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { dayDate, renewalLabel, SUBSCRIPTION_STATE_TONE } from '../lib/labels';
import { useCustomerLoyalty, useLoyaltyAccess } from '../queries';
import { SellPackageSheet, StartSubscriptionSheet } from './sale-sheets';
import { StampCardView } from './stamp-card';

/**
 * Customer 360 loyalty: stamp cards, usable packages (credits left) and running subscriptions, with
 * "sell package" / "start subscription" (web `customer-loyalty-section.tsx`). Left out when the plan has
 * no loyalty module or the member may not read it.
 */
export function CustomerLoyaltySection({ customer }: { customer: { uuid: string; name: string } }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const access = useLoyaltyAccess();
  const q = useCustomerLoyalty(customer.uuid, access.canRead);
  const [sellOpen, setSellOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  if (!access.canRead || isFeatureDisabled(q.error)) return null;
  const d = q.data;
  const empty = d && !d.stamps.length && !d.packages.length && !d.subscriptions.length;

  return (
    <Section title={tr('loyalty.customer.title')}>
      {q.isLoading ? (
        <Skeleton height={96} />
      ) : q.isError || !d ? (
        <ErrorState error={q.error} description={tr('loyalty.errors.detail')} onRetry={() => void q.refetch()} />
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          {empty ? (
            <Txt tone="secondary" variant="caption">
              {tr('loyalty.customer.empty')}
            </Txt>
          ) : null}
          {d.stamps.map((c) => (
            <StampCardView key={c.campaign_uuid} card={c} />
          ))}
          {d.packages.length || d.subscriptions.length ? (
            <Group>
              {d.packages.map((p, i) => {
                const left = p.credits_total - p.credits_used;
                return (
                  <ListRow
                    key={p.uuid}
                    left={<Package size={18} color={t.colors.primary} />}
                    title={p.name}
                    subtitle={[tr('loyalty.packages.credits_left', { left, total: p.credits_total }), p.expires_at ? tr('loyalty.packages.expires_on', { date: fmt.date(p.expires_at) }) : null].filter(Boolean).join(' · ')}
                    onPress={() => router.push(`/loyalty/customer-packages/${p.uuid}`)}
                    last={i === d.packages.length - 1 && !d.subscriptions.length}
                  />
                );
              })}
              {d.subscriptions.map((s, i) => (
                <ListRow
                  key={s.uuid}
                  left={<Repeat size={18} color={t.colors.primary} />}
                  title={s.plate ? `${s.name} · ${s.plate}` : s.name}
                  subtitle={`${tr('loyalty.fields.renewal_date')}: ${fmt.date(dayDate(s.renewal_date))} (${renewalLabel(tr, s.days_until_renewal)})`}
                  right={<Badge size="sm" tone={SUBSCRIPTION_STATE_TONE[s.state]} label={tr(`loyalty.subscription_state.${s.state}`)} />}
                  onPress={() => router.push(`/loyalty/subscriptions/${s.uuid}`)}
                  last={i === d.subscriptions.length - 1}
                />
              ))}
            </Group>
          ) : null}
          {access.canApply ? (
            <Row gap={t.spacing.sm}>
              <Button style={{ flex: 1 }} size="sm" variant="outline" label={tr('loyalty.sell.title')} icon={<Package size={16} color={t.colors.text} />} onPress={() => setSellOpen(true)} />
              <Button style={{ flex: 1 }} size="sm" variant="outline" label={tr('loyalty.start.title')} icon={<Repeat size={16} color={t.colors.text} />} onPress={() => setStartOpen(true)} />
            </Row>
          ) : null}
        </View>
      )}
      <SellPackageSheet visible={sellOpen} onClose={() => setSellOpen(false)} customer={customer} />
      <StartSubscriptionSheet visible={startOpen} onClose={() => setStartOpen(false)} customer={customer} />
    </Section>
  );
}
