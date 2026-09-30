import { router } from 'expo-router';
import { Copy, FileStack, Plus } from 'lucide-react-native';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '@/api/errors';
import { Badge, Button, Card, EmptyState, ErrorState, FilterChips, Header, IconButton, ListSkeleton, Row, SearchBar, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { CONTRACT_VARIABLES, DEFAULT_SIGNER_SLOTS } from '@/features/contract-presets/services/contract-presets.service';
import { ClonePresetSheet } from '@/features/contracts/components/contract-sheets';
import { useContractsAccess } from '@/features/contracts/lib/access';
import { contractKeys, useContractTemplatesInfinite } from '@/features/contracts/queries';
import { contractsService } from '@/features/contracts/services/contracts.service';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

type ActiveFilter = 'all' | 'true' | 'false';

export default function ContractTemplatesScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.contractsRead} title={tr('contracts.templates.title')}>
      <TemplatesList />
    </RequirePermission>
  );
}

function TemplatesList() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { canManage } = useContractsAccess();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [cloneOpen, setCloneOpen] = useState(false);
  const query = useDeferredValue(q.trim());
  const list = useContractTemplatesInfinite({ q: query || undefined, is_active: active === 'all' ? undefined : active, sort: 'title' });
  const featureLocked = list.isError && isApiError(list.error) && list.error.code === 'FEATURE_DISABLED';

  const createBlank = useApiMutation({
    key: 'contracts.templates.create',
    fn: () =>
      contractsService.createTemplate({
        title: tr('contracts.templates.create_title'),
        content_html: '<p></p>',
        content_json: {},
        variables: [...CONTRACT_VARIABLES],
        signer_slots: DEFAULT_SIGNER_SLOTS,
        signature_required: true,
        otp_required: true,
        is_active: true,
      }),
    invalidate: [contractKeys.all],
    success: tr('contracts.templates.toast.created'),
    toastValidation: true,
    onSuccess: (created) => router.push(`/contracts/templates/${created.uuid}`),
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={['top']}>
      <Header
        title={tr('contracts.templates.title')}
        subtitle={list.total ? tr('common.items_other', { count: list.total }) : tr('contracts.templates.description')}
        right={
          canManage ? (
            <>
              <IconButton label={tr('contracts.templates.clone')} icon={<Copy size={18} color={t.colors.text} />} onPress={() => setCloneOpen(true)} />
              <IconButton
                variant="primary"
                label={tr('contracts.templates.new')}
                disabled={createBlank.isPending}
                icon={<Plus size={20} color={t.colors.onPrimary} />}
                onPress={() => createBlank.mutate(undefined)}
              />
            </>
          ) : undefined
        }
      />
      <FlatList
        data={featureLocked ? [] : list.items}
        keyExtractor={(c) => c.uuid}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xxxl, gap: t.spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: t.spacing.md, paddingBottom: t.spacing.sm }}>
            <SearchBar value={q} onChangeText={setQ} placeholder={tr('contracts.fields.title')} />
            <FilterChips<ActiveFilter>
              value={active}
              onChange={setActive}
              options={[
                { value: 'all', label: tr('mobile.common.all') },
                { value: 'true', label: tr('common.active') },
                { value: 'false', label: tr('common.passive') },
              ]}
            />
          </View>
        }
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={t.colors.primary} />}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={t.colors.primary} style={{ padding: t.spacing.lg }} /> : null}
        ListEmptyComponent={
          list.isLoading ? (
            <ListSkeleton rows={5} height={68} />
          ) : featureLocked ? (
            <EmptyState title={tr('errors.codes.FEATURE_DISABLED')} description={tr('mobile.documents.feature_locked')} />
          ) : list.isError ? (
            <ErrorState description={tr('contracts.templates.error_description')} onRetry={() => list.refetch()} />
          ) : (
            <EmptyState
              icon={<FileStack size={28} color={t.colors.textMuted} />}
              title={tr('contracts.templates.empty_title')}
              description={q ? undefined : tr('contracts.templates.empty_description')}
              action={canManage && !q ? <Button label={tr('contracts.templates.clone')} onPress={() => setCloneOpen(true)} /> : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/contracts/templates/${item.uuid}`)} style={{ gap: t.spacing.xs }} accessibilityLabel={item.title}>
            <Row gap={t.spacing.sm}>
              <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                {item.title}
              </Txt>
              <Badge size="sm" tone={item.is_active ? 'success' : 'neutral'} label={item.is_active ? tr('common.active') : tr('common.passive')} />
            </Row>
            <Row gap={t.spacing.md}>
              <Txt variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                {item.category || '—'}
              </Txt>
              <Txt variant="caption" tone="muted">
                {fmt.date(item.created_at)}
              </Txt>
            </Row>
          </Card>
        )}
      />
      <ClonePresetSheet visible={cloneOpen} onClose={() => setCloneOpen(false)} />
    </SafeAreaView>
  );
}
