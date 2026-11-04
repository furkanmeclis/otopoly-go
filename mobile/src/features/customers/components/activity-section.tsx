/**
 * "Aktivite" timeline on the customer 360 screen (web `CustomerActivityTab`): audit events of the customer
 * and its records (vehicles, jobs, contracts, sales, quotes, leads, cari entries), newest first, with
 * "load more". Kinds the member cannot read are already filtered by the API. Tapping an entry opens the
 * record it is about (deleted records and vehicles / the customer itself have no link).
 */
import { router } from 'expo-router';
import { Briefcase, Car, FileSignature, FileText, ReceiptText, ShoppingBag, Target, User, Wallet, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Button, ErrorState, Group, Section, Skeleton, Txt } from '@/components/ui';
import { activityDetail, activityHref } from '@/features/customers/lib/activity';
import type { CustomerActivityEntry, CustomerActivitySubject } from '@/features/customers/services/customers.service';
import { useCustomerActivity } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const SUBJECT_ICON: Record<CustomerActivitySubject, LucideIcon> = {
  customer: User,
  vehicle: Car,
  job: Briefcase,
  sale: ShoppingBag,
  quote: FileText,
  lead: Target,
  cari_entry: Wallet,
  contract: FileSignature,
  other: ReceiptText,
};

export function CustomerActivitySection({ customerUuid, cariAccountUuid }: { customerUuid: string; cariAccountUuid?: string | null }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const activity = useCustomerActivity(customerUuid);
  const items = activity.items;

  const label = (entry: CustomerActivityEntry) => {
    const key = `activity.actions.${entry.action}`;
    const text = tr(key);
    return text === key ? entry.action : text;
  };

  return (
    <Section title={activity.total ? `${tr('customers.activity.title')} · ${activity.total}` : tr('customers.activity.title')}>
      <Group>
        {activity.isLoading && !activity.data ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={{ padding: t.spacing.lg, gap: 6 }}>
              <Skeleton height={14} width="55%" />
              <Skeleton height={12} width="35%" />
            </View>
          ))
        ) : activity.isError && !activity.data ? (
          <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
        ) : items.length === 0 ? (
          <View style={{ padding: t.spacing.lg, gap: 4 }}>
            <Txt variant="bodyStrong">{tr('customers.activity.empty_title')}</Txt>
            <Txt variant="caption" tone="secondary">
              {tr('customers.activity.empty_description')}
            </Txt>
          </View>
        ) : (
          items.map((entry, i) => {
            const Icon = SUBJECT_ICON[entry.subject] ?? ReceiptText;
            const href = activityHref(entry, cariAccountUuid);
            const actor = entry.actor ? `${entry.actor.name} ${entry.actor.surname}`.trim() : tr('customers.activity.system');
            const description = [tr(`customers.activity.subject.${entry.subject}`), activityDetail(entry)].filter(Boolean).join(' · ');
            const last = i === items.length - 1 && !activity.hasNextPage;
            return (
              <Pressable
                key={entry.uuid}
                disabled={!href}
                onPress={href ? () => router.push(href as never) : undefined}
                accessibilityRole={href ? 'link' : 'text'}
                accessibilityLabel={`${label(entry)}, ${description}, ${fmt.dateTime(entry.created_at)}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: t.spacing.md,
                  paddingHorizontal: t.spacing.lg,
                  paddingVertical: t.spacing.md,
                  borderBottomWidth: last ? 0 : 1,
                  borderBottomColor: t.colors.border,
                  backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
                })}
              >
                <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.primarySoft }}>
                  <Icon size={15} color={t.colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" tone={href ? 'primary' : 'default'} numberOfLines={2}>
                    {label(entry)}
                  </Txt>
                  {description ? (
                    <Txt variant="caption" tone="secondary" numberOfLines={2}>
                      {description}
                    </Txt>
                  ) : null}
                  <Txt variant="caption" tone="muted">
                    {`${fmt.relative(entry.created_at)} · ${actor}`}
                  </Txt>
                </View>
              </Pressable>
            );
          })
        )}
        {activity.hasNextPage ? (
          <View style={{ padding: t.spacing.md, alignItems: 'center' }}>
            <Button
              size="sm"
              variant="ghost"
              label={tr('customers.activity.load_more')}
              loading={activity.isFetchingNextPage}
              onPress={() => void activity.fetchNextPage()}
            />
          </View>
        ) : null}
      </Group>
    </Section>
  );
}
