/** Home dashboard card: subscriptions renewing in the next 7 days and past due ones (web `renewals-widget.tsx`). */
import { router } from 'expo-router';
import { Repeat } from 'lucide-react-native';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Group, ListRow, Row, Section, Skeleton, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { renewalLabel, SUBSCRIPTION_STATE_TONE } from '../lib/labels';
import { useLoyaltyAccess, useLoyaltyOverview } from '../queries';

const MAX_ROWS = 5;

export function LoyaltyRenewalsCard() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { canRead } = useLoyaltyAccess();
  const q = useLoyaltyOverview(7, canRead);
  // Hidden without the permission, on a plan without the module, and while there is nothing to renew.
  if (!canRead || isFeatureDisabled(q.error) || q.isError) return null;
  const rows = (q.data?.renewals ?? []).slice(0, MAX_ROWS);
  if (q.data && !rows.length && !q.data.subscriptions_active && !q.data.subscriptions_past_due) return null;

  return (
    <Section title={tr('loyalty.widget.title')} action={{ label: tr('loyalty.widget.open'), onPress: () => router.push({ pathname: '/loyalty', params: { tab: 'subscriptions' } }) }}>
      <Group>
        {q.isLoading ? (
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            {[0, 1].map((i) => (
              <Skeleton key={i} height={36} />
            ))}
          </View>
        ) : rows.length === 0 ? (
          <Row gap={t.spacing.sm} style={{ padding: t.spacing.xl, justifyContent: 'center' }}>
            <Repeat size={18} color={t.colors.textMuted} />
            <Txt tone="secondary" variant="caption">
              {tr('loyalty.widget.empty')}
            </Txt>
          </Row>
        ) : (
          rows.map((s, i) => (
            <ListRow
              key={s.uuid}
              title={s.customer_name}
              subtitle={`${s.name} · ${fmt.money(s.price, s.currency)}`}
              right={<Badge size="sm" tone={s.state === 'past_due' ? SUBSCRIPTION_STATE_TONE.past_due : s.days_until_renewal <= 1 ? 'warning' : 'neutral'} label={renewalLabel(tr, s.days_until_renewal)} />}
              onPress={() => router.push(`/loyalty/subscriptions/${s.uuid}`)}
              last={i === rows.length - 1}
            />
          ))
        )}
      </Group>
    </Section>
  );
}
