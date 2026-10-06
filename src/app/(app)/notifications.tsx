/** In-app notifications inbox — web header inbox (`features/notifications/components/notification-inbox.tsx`). */
import { router } from 'expo-router';
import { BellOff, CheckCheck, Settings2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, Header, IconButton, ListSkeleton, Row, Segmented, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { isUnreadNotification } from '@/features/notifications/deep-links';
import { NotificationKindIcon, useOpenNotification } from '@/features/notifications/components/notification-parts';
import { useInboxInfinite, useNotificationMutations, useUnreadCount } from '@/features/notifications/queries';
import type { AppNotification } from '@/features/notifications/services/notifications.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

type Filter = 'all' | 'unread';

export default function NotificationsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.notificationsRead} title={tr('notifications.inbox.title')}>
      <Inbox />
    </RequirePermission>
  );
}

function Inbox() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const list = useInboxInfinite(filter === 'unread' ? { unread: 'true' } : {});
  const unread = useUnreadCount();
  const { markRead, markAllRead } = useNotificationMutations();
  const { open, targetOf } = useOpenNotification();
  const unreadCount = unread.data ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('notifications.inbox.title')}
        subtitle={unreadCount ? tr('notifications.inbox.trigger_unread', { count: unreadCount }) : tr('notifications.inbox.subtitle')}
        right={
          <>
            {unreadCount > 0 ? (
              <IconButton
                label={tr('notifications.inbox.mark_all_read')}
                icon={<CheckCheck size={20} color={t.colors.text} />}
                disabled={markAllRead.isPending}
                onPress={() => markAllRead.mutate(undefined)}
              />
            ) : null}
            <IconButton label={tr('mobile.notifications.preferences')} icon={<Settings2 size={20} color={t.colors.text} />} onPress={() => router.push('/profile/preferences')} />
          </>
        }
      />
      <FlatList
        data={list.items}
        keyExtractor={(n) => n.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingBottom: t.spacing.sm }}>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'unread', label: tr('notifications.unread'), count: unreadCount || undefined },
              ]}
            />
          </View>
        }
        renderItem={({ item }) => (
          <NotificationRow
            item={item}
            hasAction={Boolean(targetOf(item))}
            onOpen={() => void open(item)}
            onMarkRead={() => markRead.mutate(item.uuid)}
          />
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={6} height={84} />
          ) : list.isError ? (
            <ErrorState description={tr('notifications.inbox.error')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<BellOff size={28} color={t.colors.textMuted} />}
              title={filter === 'unread' ? tr('mobile.notifications.inbox.no_unread') : tr('notifications.inbox.empty')}
              description={tr('notifications.inbox.empty_hint')}
            />
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ paddingVertical: t.spacing.lg }} /> : undefined}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => {
              list.refetch();
              unread.refetch();
            }}
            tintColor={t.colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
}

function NotificationRow({ item, hasAction, onOpen, onMarkRead }: { item: AppNotification; hasAction: boolean; onOpen: () => void; onMarkRead: () => void }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const unread = isUnreadNotification(item);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? `${tr('notifications.unread')}: ` : ''}${item.title}`}
      accessibilityHint={hasAction ? tr('notifications.actions.open') : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: t.spacing.md,
        padding: t.spacing.md,
        borderRadius: t.radius.lg,
        borderWidth: 1,
        borderColor: unread ? t.colors.primarySoft : t.colors.border,
        backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: unread ? t.colors.primarySoft : t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <NotificationKindIcon kind={item.template_code} color={unread ? t.colors.primary : t.colors.textSecondary} />
        {unread ? (
          <View style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.primary, borderWidth: 2, borderColor: t.colors.surface }} />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
          <Txt variant={unread ? 'bodyStrong' : 'body'} tone={unread ? 'default' : 'secondary'} numberOfLines={2} style={{ flex: 1 }}>
            {item.title}
          </Txt>
          <Txt variant="caption" tone="muted" style={{ fontSize: 11 }}>
            {fmt.relative(item.created_at)}
          </Txt>
        </Row>
        {item.body ? (
          <Txt variant="caption" tone="secondary" numberOfLines={3}>
            {item.body}
          </Txt>
        ) : null}
        {hasAction || unread ? (
          <Row gap={t.spacing.sm} style={{ paddingTop: 4 }}>
            {hasAction ? <Button size="sm" label={tr('notifications.actions.open')} onPress={onOpen} /> : null}
            {unread ? <Button size="sm" variant="ghost" label={tr('notifications.actions.mark_read')} onPress={onMarkRead} /> : null}
          </Row>
        ) : null}
      </View>
    </Pressable>
  );
}
