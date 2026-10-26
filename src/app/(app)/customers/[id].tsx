/**
 * Customer 360 — web `/t/[slug]/customers/[uuid]` plus the records linked to the customer: vehicles,
 * jobs, quotes, leads, cari (balance + entries) and todos, with call / WhatsApp / SMS / email and
 * "new job / quote / lead" shortcuts. Every linked record opens its own screen.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Briefcase, FileText, Mail, MessageCircle, MessageSquare, Pencil, Phone, Plus, Target, Trash2, Wallet, Car } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import {
  Avatar,
  Badge,
  BrandLogo,
  Button,
  Card,
  DetailHero,
  ErrorState,
  Header,
  IconButton,
  InfoRow,
  ListRow,
  ListSkeleton,
  PlateBadge,
  QuickActions,
  RelatedSection,
  Row,
  Screen,
  StatGrid,
  Txt,
  useConfirm,
  usePullRefresh,
  type StatItem,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { AddVehicleSheet } from '@/features/customers/components/pickers';
import { customersService } from '@/features/customers/services/customers.service';
import { JobStatusBadge, PaymentBadge } from '@/features/jobs/components/job-parts';
import { leadStatusTone } from '@/features/leads/lib/lead-ui';
import { qk, useCariEntriesInfinite, useCustomer, useCustomerJobs, useLeads, useQuotes, useTodos } from '@/features/queries';
import { quoteStatusTone } from '@/features/quotes/lib/quote-ui';
import { TodoRow } from '@/features/todos/components/todo-row';
import { contact } from '@/lib/contact';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

export default function CustomerDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.customersRead} title={tr('customers.detail.info')}>
      <CustomerDetail />
    </RequirePermission>
  );
}

function CustomerDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const confirm = useConfirm();
  const customer = useCustomer(id);
  const c = customer.data;
  const jobs = useCustomerJobs(can(P.jobsRead) ? id : '');
  const cari = useCariEntriesInfinite(can(P.cariRead) && c?.cari_account_uuid ? c.cari_account_uuid : '', { limit: 5 });
  const quotes = useQuotes({ customer_uuid: id, limit: 20 }, can(P.quotesRead));
  const leads = useLeads({ customer_uuid: id, limit: 20 }, can(P.leadsRead));
  const todos = useTodos({ customer: id, limit: 10 }, can(P.todosRead));
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const canWrite = can(P.customersWrite);
  const pull = usePullRefresh(customer, can(P.jobsRead) && jobs, can(P.quotesRead) && quotes, can(P.leadsRead) && leads, can(P.todosRead) && todos);

  const remove = useApiMutation({
    key: 'customers.delete',
    fn: () => customersService.remove(id),
    invalidate: [qk.customers],
    success: tr('customers.toast.deleted'),
    toastValidation: true,
    onSuccess: () => router.back(),
  });
  const removeVehicle = useApiMutation({
    key: 'customers.vehicle.remove',
    fn: (uuid: string) => customersService.removeVehicle(uuid),
    invalidate: [qk.customers],
    success: tr('customers.toast.vehicle_removed'),
    toastValidation: true,
  });

  if (customer.isLoading) {
    return (
      <Screen header={<Header title={tr('customers.detail.info')} />}>
        <ListSkeleton rows={4} height={90} />
      </Screen>
    );
  }
  if (customer.isError || !c) {
    return (
      <Screen header={<Header title={tr('customers.detail.info')} />}>
        <ErrorState error={customer.error} description={tr('customers.error_description')} onRetry={() => customer.refetch()} />
      </Screen>
    );
  }

  const balance = toNumber(c.cari_balance);
  const jobItems = jobs.data?.items ?? [];
  const openJobs = jobItems.filter((j) => j.status === 'in_progress' || j.status === 'ready').length;
  const unpaidJobs = jobItems.filter((j) => j.payment_status === 'unpaid' && j.status !== 'cancelled' && j.status !== 'voided').length;
  // Modules off on the plan: leave the section out instead of showing a lock in the middle of the page.
  const showQuotes = can(P.quotesRead) && !isFeatureDisabled(quotes.error);
  const showLeads = can(P.leadsRead) && !isFeatureDisabled(leads.error);
  const phone = c.phone?.trim();

  const stats: StatItem[] = [];
  if (can(P.cariRead)) {
    stats.push({
      label: tr('cari.balance'),
      value: fmt.money(balance),
      hint: balance > 0 ? tr('mobile.detail.receivable') : balance < 0 ? tr('mobile.detail.payable') : tr('mobile.detail.settled'),
      tone: balance > 0 ? 'danger' : balance < 0 ? 'success' : 'default',
      icon: <Wallet size={14} color={t.colors.textSecondary} />,
      onPress: c.cari_account_uuid ? () => router.push(`/cari/${c.cari_account_uuid}`) : undefined,
    });
  }
  if (can(P.jobsRead)) {
    stats.push({
      label: tr('mobile.detail.jobs'),
      value: String(jobs.data?.total ?? 0),
      hint: jobItems[0] ? `${tr('mobile.detail.last_job')}: ${fmt.date(jobItems[0].started_at)}` : tr('mobile.detail.never'),
      icon: <Briefcase size={14} color={t.colors.textSecondary} />,
      loading: jobs.isLoading,
    });
    stats.push({
      label: tr('mobile.detail.unpaid_jobs'),
      value: String(unpaidJobs),
      hint: openJobs ? `${tr('mobile.detail.open_jobs')}: ${openJobs}` : undefined,
      tone: unpaidJobs ? 'warning' : 'default',
      loading: jobs.isLoading,
    });
  }
  stats.push({ label: tr('mobile.detail.vehicles'), value: String(c.vehicles.length), icon: <Car size={14} color={t.colors.textSecondary} /> });

  return (
    <Screen
      header={
        <Header
          title={c.name}
          subtitle={tr(`customers.kind.${c.kind}`)}
          right={canWrite ? <IconButton label={tr('common.edit')} icon={<Pencil size={18} color={t.colors.text} />} onPress={() => router.push({ pathname: '/customers/form', params: { id: c.uuid } })} /> : undefined}
        />
      }
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
    >
      <DetailHero
        leading={<Avatar name={c.name} size={52} />}
        title={c.name}
        subtitle={[phone, c.email].filter(Boolean).join(' · ') || undefined}
        badges={
          <>
            <Badge size="sm" tone={c.kind === 'company' ? 'info' : 'neutral'} label={tr(`customers.kind.${c.kind}`)} />
            <Badge size="sm" tone={c.is_active ? 'success' : 'neutral'} label={c.is_active ? tr('common.active') : tr('common.passive')} />
          </>
        }
      >
        <QuickActions
          actions={[
            phone && { key: 'call', label: tr('mobile.detail.call'), icon: <Phone size={20} color={t.colors.primary} />, onPress: () => contact.call(phone) },
            phone && { key: 'wa', label: tr('mobile.detail.whatsapp'), icon: <MessageCircle size={20} color={t.colors.primary} />, onPress: () => contact.whatsapp(phone) },
            phone && { key: 'sms', label: tr('mobile.detail.sms'), icon: <MessageSquare size={20} color={t.colors.primary} />, onPress: () => contact.sms(phone) },
            c.email && { key: 'mail', label: tr('mobile.detail.email'), icon: <Mail size={20} color={t.colors.primary} />, onPress: () => contact.email(c.email) },
            can(P.jobsWrite) && {
              key: 'job',
              label: tr('mobile.detail.new_job'),
              tone: 'primary',
              icon: <Plus size={20} color={t.colors.onPrimary} />,
              onPress: () => router.push({ pathname: '/jobs/new', params: { customer: c.uuid } }),
            },
            can(P.quotesWrite) &&
              showQuotes && {
                key: 'quote',
                label: tr('mobile.detail.new_quote'),
                icon: <FileText size={20} color={t.colors.primary} />,
                onPress: () => router.push({ pathname: '/quotes/form', params: { customer: c.uuid } }),
              },
            can(P.leadsWrite) &&
              showLeads && {
                key: 'lead',
                label: tr('mobile.detail.new_lead'),
                icon: <Target size={20} color={t.colors.primary} />,
                onPress: () => router.push({ pathname: '/leads/form', params: { customer: c.uuid } }),
              },
          ]}
        />
      </DetailHero>

      <StatGrid items={stats} />

      <RelatedSection
        title={tr('customers.detail.vehicles')}
        items={c.vehicles}
        empty={tr('customers.detail.no_vehicles')}
        action={canWrite ? { label: tr('customers.detail.add_vehicle'), onPress: () => setVehicleOpen(true) } : undefined}
        renderItem={(v, i, last) => (
          <ListRow
            key={v.uuid}
            title={`${v.brand_name} ${v.model_name}`}
            subtitle={String(v.year)}
            left={
              <Row gap={t.spacing.sm}>
                <BrandLogo name={v.brand_name} logoUrl={v.logo_url} size="md" />
                <PlateBadge plate={v.plate} size="sm" />
              </Row>
            }
            right={
              <Row gap={4}>
                {can(P.jobsWrite) ? (
                  <IconButton
                    variant="ghost"
                    label={tr('mobile.detail.vehicle_new_job', { plate: v.plate })}
                    icon={<Plus size={18} color={t.colors.primary} />}
                    onPress={() => router.push({ pathname: '/jobs/new', params: { customer: c.uuid, vehicle: v.uuid } })}
                  />
                ) : null}
                {canWrite ? (
                  <IconButton
                    variant="ghost"
                    label={tr('common.delete')}
                    icon={<Trash2 size={16} color={t.colors.danger} />}
                    onPress={async () => {
                      if (await confirm({ title: v.plate, message: tr('customers.detail.remove_vehicle_confirm'), destructive: true, confirmLabel: tr('common.delete') })) removeVehicle.mutate(v.uuid);
                    }}
                  />
                ) : null}
              </Row>
            }
            chevron={false}
            last={last}
          />
        )}
      />

      {can(P.jobsRead) ? (
        <RelatedSection
          title={tr('customers.detail.recent_jobs')}
          items={jobs.data?.items}
          count={jobs.data?.total}
          loading={jobs.isLoading}
          error={jobs.error}
          onRetry={() => void jobs.refetch()}
          empty={tr('customers.detail.no_jobs')}
          renderItem={(j, i, last) => (
            <ListRow
              key={j.uuid}
              title={`${j.plate} · ${fmt.money(j.total_amount, j.currency)}`}
              subtitle={[fmt.dateTime(j.started_at), (j.services ?? []).map((s) => s.name).join(', ')].filter(Boolean).join(' · ')}
              left={<BrandLogo name={j.brand_name || j.vehicle_label} logoUrl={j.brand_logo_url} size="sm" />}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <JobStatusBadge status={j.status} size="sm" />
                  {j.status !== 'cancelled' && j.status !== 'voided' ? <PaymentBadge status={j.payment_status} size="sm" /> : null}
                </View>
              }
              onPress={() => router.push(`/jobs/${j.uuid}`)}
              last={last}
            />
          )}
        />
      ) : null}

      {showQuotes ? (
        <RelatedSection
          title={tr('mobile.detail.quotes')}
          items={quotes.data?.items}
          count={quotes.data?.total}
          loading={quotes.isLoading}
          error={quotes.error}
          onRetry={() => void quotes.refetch()}
          empty={tr('mobile.detail.no_quotes')}
          renderItem={(q, i, last) => (
            <ListRow
              key={q.uuid}
              title={`${q.number} · ${fmt.money(q.grand_total, q.currency)}`}
              subtitle={[q.vehicle_plate, fmt.date(q.created_at)].filter(Boolean).join(' · ')}
              right={<Badge size="sm" tone={quoteStatusTone(q.status)} label={tr(`quotes.status.${q.status}`)} />}
              onPress={() => router.push(`/quotes/${q.uuid}`)}
              last={last}
            />
          )}
        />
      ) : null}

      {showLeads ? (
        <RelatedSection
          title={tr('mobile.detail.leads')}
          items={leads.data?.items}
          count={leads.data?.total}
          loading={leads.isLoading}
          error={leads.error}
          onRetry={() => void leads.refetch()}
          empty={tr('mobile.detail.no_leads')}
          renderItem={(l, i, last) => (
            <ListRow
              key={l.uuid}
              title={l.interest || tr('leads.no_interest')}
              subtitle={[l.vehicle_plate || l.vehicle_text, tr(`leads.source.${l.source}`), fmt.date(l.created_at)].filter(Boolean).join(' · ')}
              right={<Badge size="sm" tone={leadStatusTone(l.status)} label={tr(`leads.status.${l.status}`)} />}
              onPress={() => router.push(`/leads/${l.uuid}`)}
              last={last}
            />
          )}
        />
      ) : null}

      {can(P.cariRead) ? (
        <RelatedSection
          title={tr('customers.detail.recent_cari_entries')}
          items={cari.items}
          loading={cari.isLoading}
          empty={tr('customers.detail.no_cari_entries')}
          action={c.cari_account_uuid ? { label: tr('customers.detail.view_cari'), onPress: () => router.push(`/cari/${c.cari_account_uuid}`) } : undefined}
          renderItem={(e, i, last) => (
            <ListRow
              key={e.uuid}
              title={e.description || tr(`cari.entry_type.${e.type}`)}
              subtitle={`${fmt.date(e.entry_date)} · ${tr(`cari.entry_type.${e.type}`)}`}
              right={
                <Txt variant="mono" tone={e.status === 'void' ? 'muted' : e.type === 'payment' ? 'success' : 'default'} style={e.status === 'void' ? { textDecorationLine: 'line-through' } : undefined}>
                  {e.type === 'payment' ? '-' : '+'}
                  {fmt.money(e.amount)}
                </Txt>
              }
              onPress={c.cari_account_uuid ? () => router.push(`/cari/${c.cari_account_uuid}`) : undefined}
              chevron={false}
              last={last}
            />
          )}
        />
      ) : null}

      {can(P.todosRead) ? (
        <RelatedSection
          title={tr('todos.title')}
          items={todos.data?.items}
          loading={todos.isLoading}
          error={isFeatureDisabled(todos.error) ? undefined : todos.error}
          onRetry={() => void todos.refetch()}
          empty={tr('todos.empty')}
          renderItem={(todo, i, last) => <TodoRow key={todo.uuid} todo={todo} canWrite={can(P.todosWrite)} last={last} />}
        />
      ) : null}

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('customers.fields.phone')} value={c.phone} />
        <InfoRow label={tr('customers.fields.email')} value={c.email} />
        {c.kind === 'company' ? (
          <>
            <InfoRow label={tr('customers.fields.tax_id')} value={c.tax_id} />
            <InfoRow label={tr('customers.fields.tax_office')} value={c.tax_office} />
          </>
        ) : null}
        <InfoRow label={tr('customers.created_at')} value={fmt.date(c.created_at)} />
        <InfoRow label={tr('customers.fields.notes')} value={c.notes || '—'} last />
      </Card>

      {canWrite ? (
        <Button
          variant="outline"
          label={tr('customers.detail.delete')}
          icon={<Trash2 size={18} color={t.colors.danger} />}
          loading={remove.isPending}
          onPress={async () => {
            if (await confirm({ title: tr('customers.detail.delete'), message: tr('customers.detail.delete_confirm'), destructive: true, confirmLabel: tr('common.delete') })) remove.mutate(undefined);
          }}
        />
      ) : null}

      <AddVehicleSheet customerUuid={c.uuid} visible={vehicleOpen} onClose={() => setVehicleOpen(false)} onCreated={() => setVehicleOpen(false)} />
    </Screen>
  );
}
