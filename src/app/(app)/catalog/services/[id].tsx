import { router, useLocalSearchParams } from 'expo-router';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, Card, DetailHero, ErrorState, Header, IconButton, InfoRow, LinkValue, ListSkeleton, QuickActions, Row, Screen, Section, StatGrid, Txt, useConfirm, usePullRefresh } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { ActiveBadge, ServiceDot, useCatalogAccess } from '@/features/catalog/components/catalog-parts';
import { ServiceRecipeCard } from '@/features/catalog/components/service-recipe-card';
import { serviceSwatch } from '@/features/catalog/lib/service-colors';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { qk, useService, useServiceProducts } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.catalog.service');

export default function ServiceDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.catalogRead} title={tr('catalog.detail.service_title')}>
      <ServiceDetail />
    </RequirePermission>
  );
}

function ServiceDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canWrite } = useCatalogAccess();
  const confirm = useConfirm();
  const query = useService(id);
  const s = query.data;
  const { can } = useAuth();
  // Same query as the recipe card below: material cost per job of this service.
  const recipe = useServiceProducts(id);
  const pull = usePullRefresh(query, recipe);

  const remove = useApiMutation({
    key: 'catalog.services.delete',
    fn: () => catalogService.deleteService(id),
    invalidate: [qk.catalog],
    success: tr('catalog.services.deleted_success'),
    toastValidation: true,
    onSuccess: () => {
      log.info('Service deleted', { uuid: id });
      router.back();
    },
  });

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('catalog.detail.service_title')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (query.isError || !s) {
    return (
      <Screen header={<Header title={tr('catalog.detail.service_title')} />}>
        <ErrorState error={query.error} description={tr('catalog.detail.service_not_found')} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  const sw = serviceSwatch(s.color, s.name, t.scheme);
  const materialCost = (recipe.data?.items ?? []).reduce((sum, r) => sum + toNumber(r.qty) * toNumber(r.cost_price), 0);
  const margin = toNumber(s.price) - materialCost;

  return (
    <Screen
      header={
        <Header
          title={s.name}
          subtitle={tr('catalog.detail.service_description')}
          right={canWrite ? <IconButton label={tr('common.edit')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => router.push({ pathname: '/catalog/services/form', params: { id: s.uuid } })} /> : undefined}
        />
      }
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
    >
      <DetailHero
        leading={
          <View style={{ width: 52, height: 52, borderRadius: t.radius.lg, backgroundColor: sw.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Wrench size={24} color={sw.text} />
          </View>
        }
        title={s.name}
        subtitle={[s.category_name, s.code].filter(Boolean).join(' · ') || undefined}
        badges={
          <>
            <ActiveBadge active={s.is_active} />
            <Row gap={6} style={{ backgroundColor: sw.bg, borderRadius: t.radius.full, paddingHorizontal: t.spacing.sm, paddingVertical: 2 }}>
              <ServiceDot service={s} size={8} />
              <Txt variant="caption" style={{ color: sw.text, fontWeight: '600' }}>
                {tr('catalog.services.color')}
              </Txt>
            </Row>
          </>
        }
      >
        <QuickActions
          actions={[
            can(P.jobsWrite) && { key: 'job', label: tr('mobile.detail.new_job'), tone: 'primary', icon: <Plus size={20} color={t.colors.onPrimary} />, onPress: () => router.push('/jobs/new') },
            canWrite && { key: 'edit', label: tr('common.edit'), icon: <Pencil size={20} color={t.colors.primary} />, onPress: () => router.push({ pathname: '/catalog/services/form', params: { id: s.uuid } }) },
          ]}
        />
      </DetailHero>

      <StatGrid
        items={[
          { label: tr('catalog.services.price'), value: fmt.money(s.price, s.currency), hint: tr('catalog.services.vat_suffix', { rate: s.vat_rate }) },
          { label: tr('catalog.services.duration'), value: tr('catalog.services.duration_value', { minutes: s.duration_minutes }) },
          { label: tr('jobs.consumptions.material_cost'), value: fmt.money(materialCost, s.currency), loading: recipe.isLoading },
          { label: tr('jobs.consumptions.margin'), value: fmt.money(margin, s.currency), tone: margin >= 0 ? 'success' : 'danger', loading: recipe.isLoading },
        ]}
      />

      <Section title={tr('catalog.detail.service_info')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.services.name')} value={s.name} />
          <InfoRow label={tr('catalog.services.category')}>
            <LinkValue label={s.category_name || '—'} onPress={s.category_uuid ? () => router.push(`/catalog/categories/${s.category_uuid}`) : undefined} />
          </InfoRow>
          <InfoRow label={tr('catalog.services.code')} value={s.code || '—'} />
          <InfoRow label={tr('catalog.services.duration')} value={tr('catalog.services.duration_value', { minutes: s.duration_minutes })} last />
        </Card>
      </Section>

      <Section title={tr('mobile.catalog.pricing')}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('catalog.services.price')} value={fmt.money(s.price, s.currency)} />
          <InfoRow label={tr('catalog.services.vat_rate')} value={tr('catalog.services.vat_suffix', { rate: s.vat_rate })} />
          <InfoRow label={tr('catalog.services.currency')} value={s.currency} />
          <InfoRow label={tr('catalog.detail.created_at')} value={fmt.dateTime(s.created_at)} />
          <InfoRow label={tr('catalog.detail.updated_at')} value={fmt.dateTime(s.updated_at)} last />
        </Card>
      </Section>

      {s.description ? (
        <Card>
          <Txt tone="secondary">{s.description}</Txt>
        </Card>
      ) : null}

      <ServiceRecipeCard service={s} canWrite={canWrite} />

      {canWrite ? (
        <Button
          variant="outline"
          label={tr('catalog.services.delete')}
          icon={<Trash2 size={18} color={t.colors.danger} />}
          loading={remove.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('catalog.services.delete'), message: tr('catalog.services.delete_confirm'), destructive: true, confirmLabel: tr('common.delete') })) remove.mutate(undefined);
          }}
        />
      ) : null}
    </Screen>
  );
}
