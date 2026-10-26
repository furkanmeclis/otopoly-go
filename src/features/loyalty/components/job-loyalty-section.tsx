import { Gift, Package, Repeat, Undo2 } from 'lucide-react-native';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Button, ErrorState, Group, ListRow, Section, Skeleton, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { useJobLoyalty, useLoyaltyAccess, useLoyaltyMutations } from '../queries';
import type { LoyaltyKind } from '../types';
import { StampCardView } from './stamp-card';

function KindIcon({ kind, color }: { kind: LoyaltyKind; color: string }) {
  if (kind === 'reward') return <Gift size={18} color={color} />;
  if (kind === 'package') return <Package size={18} color={color} />;
  return <Repeat size={18} color={color} />;
}

/**
 * Job loyalty: what covers the lines (revert while the job is open and unpaid), what can still cover them
 * (stamp rewards, package credits, subscription uses — biggest saving first) and the customer's stamp cards
 * (web `job-loyalty-section.tsx`). Left out when the plan has no loyalty module.
 */
export function JobLoyaltySection({ jobUuid, currency, canWriteJob }: { jobUuid: string; currency: string; canWriteJob: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const access = useLoyaltyAccess();
  const q = useJobLoyalty(jobUuid, access.canRead);
  const { apply, revert } = useLoyaltyMutations();
  if (!access.canRead || isFeatureDisabled(q.error)) return null;
  const d = q.data;
  const canChange = Boolean(d?.editable) && access.canApply && canWriteJob;
  const applied = d?.applied.filter((a) => a.status === 'applied') ?? [];
  const nothing = d && !applied.length && !d.options.length && !d.stamps.length && !d.stamps_earned.length;
  if (nothing) return null;
  const busy = apply.isPending || revert.isPending;

  return (
    <Section title={tr('loyalty.job.title')}>
      {q.isLoading ? (
        <Skeleton height={80} />
      ) : q.isError || !d ? (
        <ErrorState error={q.error} description={tr('loyalty.errors.detail')} onRetry={() => void q.refetch()} />
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          {d.stamps_earned.length ? (
            <Badge tone="success" icon={<Gift size={12} color={t.colors.success} />} label={tr('loyalty.job.stamp_earned', { names: d.stamps_earned.map((c) => c.name).join(', ') })} />
          ) : null}
          {applied.length ? (
            <Group>
              {applied.map((a, i) => (
                <ListRow
                  key={a.uuid}
                  left={<KindIcon kind={a.kind} color={t.colors.success} />}
                  title={`${a.line_name} · −${fmt.money(a.discount_amount, currency)}`}
                  subtitle={`${tr(`loyalty.kind_badge.${a.kind}`)}: ${a.source_name}`}
                  right={
                    canChange ? (
                      <Button
                        size="sm"
                        variant="outline"
                        label={tr('loyalty.job.revert')}
                        icon={<Undo2 size={14} color={t.colors.text} />}
                        disabled={busy}
                        onPress={() => revert.mutate({ jobUuid, applicationUuid: a.uuid })}
                      />
                    ) : undefined
                  }
                  chevron={false}
                  last={i === applied.length - 1}
                />
              ))}
            </Group>
          ) : null}
          {canChange && d.options.length ? (
            <>
              <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
                {tr('loyalty.job.available')}
              </Txt>
              <Group>
                {d.options.map((o, i) => (
                  <ListRow
                    key={`${o.kind}:${o.source_uuid}:${o.line_uuid}`}
                    left={<KindIcon kind={o.kind} color={t.colors.primary} />}
                    title={`${o.line_name} · −${fmt.money(o.discount_amount, currency)}`}
                    subtitle={[
                      `${tr(`loyalty.kind_badge.${o.kind}`)}: ${o.source_name}`,
                      o.kind !== 'reward' ? tr('loyalty.job.units', { count: o.units }) : null,
                      o.remaining !== undefined ? tr('loyalty.job.remaining_after', { count: o.remaining }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <Button
                        size="sm"
                        variant="secondary"
                        label={tr(`loyalty.job.apply_${o.kind}`)}
                        disabled={busy}
                        onPress={() => apply.mutate({ jobUuid, body: { kind: o.kind, source_uuid: o.source_uuid, line_uuid: o.line_uuid } })}
                      />
                    }
                    chevron={false}
                    last={i === d.options.length - 1}
                  />
                ))}
              </Group>
            </>
          ) : null}
          {d.stamps.map((c) => (
            <StampCardView key={c.campaign_uuid} card={c} />
          ))}
        </View>
      )}
    </Section>
  );
}
