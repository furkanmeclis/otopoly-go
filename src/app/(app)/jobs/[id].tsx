import { useLocalSearchParams } from 'expo-router';
import { Ban, CheckCircle2, KeyRound, Minus, PackagePlus, Plus, Trash2, Undo2, Wallet } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Group,
  Header,
  InfoRow,
  ListSkeleton,
  PlateBadge,
  Row,
  Screen,
  Section,
  SelectField,
  Sheet,
  TextField,
  Txt,
  useConfirm,
} from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { JobContractsSection } from '@/features/contracts/components/job-contracts-section';
import { CloseJobSheet } from '@/features/jobs/components/close-job-sheet';
import { JobStatusBadge, PaymentBadge, ServiceTags } from '@/features/jobs/components/job-parts';
import { jobsService, type JobDetail } from '@/features/jobs/services/jobs.service';
import { MONEY_KEYS, qk, useJob, useProducts, useStaffOptions } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useApiMutation } from '@/lib/mutation';
import { LiveActivityCard } from '@/features/widgets/live-activity-card';
import { useTheme } from '@/theme/provider';
import { useMarkInteractive } from '@/lib/monitoring/observe';

export default function JobDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.jobsRead} title={tr('jobs.detail.title')}>
      <JobDetailContent />
    </RequirePermission>
  );
}

function JobDetailContent() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, isOwner } = useAuth();
  const confirm = useConfirm();
  const job = useJob(id);
  // Opened from widgets, Live Activities / Updates and notifications: interactive once the job has loaded.
  useMarkInteractive(!job.isLoading);
  const d = job.data;
  const canWrite = can(P.jobsWrite);
  const canVoid = isOwner && canWrite;
  const status = d?.status;
  const canEdit = canWrite && (status === 'in_progress' || status === 'ready');
  const canPay = canWrite && d?.payment_status === 'unpaid' && status !== 'cancelled' && status !== 'voided';
  const canCancel = canWrite && (status === 'in_progress' || status === 'ready');
  const [notesOpen, setNotesOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const inv = [qk.jobs, qk.reports, qk.catalog];
  const ready = useApiMutation({ key: 'jobs.ready', fn: () => jobsService.ready(id), invalidate: inv, success: tr('jobs.toast.ready'), toastValidation: true });
  const deliver = useApiMutation({
    key: 'jobs.deliver',
    fn: () => jobsService.deliver(id),
    invalidate: inv,
    success: tr('jobs.toast.delivered'),
    toastValidation: true,
    onSuccess: (res) => {
      if (res.payment_status === 'unpaid') setPayOpen(true);
    },
  });
  const cancel = useApiMutation({ key: 'jobs.cancel', fn: () => jobsService.cancel(id), invalidate: MONEY_KEYS, success: tr('jobs.toast.cancelled'), toastValidation: true });
  const voidJob = useApiMutation({ key: 'jobs.void', fn: () => jobsService.void(id), invalidate: MONEY_KEYS, success: tr('jobs.toast.voided'), toastValidation: true });

  const busy = ready.isPending || deliver.isPending || cancel.isPending || voidJob.isPending;

  if (job.isLoading) {
    return (
      <Screen header={<Header title={tr('jobs.detail.title')} />}>
        <ListSkeleton rows={4} height={110} />
      </Screen>
    );
  }
  if (job.isError || !d) {
    return (
      <Screen header={<Header title={tr('jobs.detail.title')} />}>
        <ErrorState error={job.error} description={tr('jobs.detail.error')} onRetry={() => job.refetch()} />
      </Screen>
    );
  }

  const showVoid = canVoid && d.payment_status === 'paid' && d.status !== 'voided';

  const actions = canWrite ? (
    <View style={{ gap: t.spacing.sm }}>
      <Row gap={t.spacing.sm}>
        {status === 'in_progress' ? (
          <Button style={{ flex: 1 }} variant="outline" label={tr('jobs.actions.ready')} icon={<CheckCircle2 size={18} color={t.colors.text} />} onPress={() => ready.mutate(undefined)} loading={ready.isPending} disabled={busy} />
        ) : null}
        {status === 'ready' || status === 'in_progress' ? (
          <Button style={{ flex: 1 }} label={tr('jobs.actions.deliver')} icon={<KeyRound size={18} color={t.colors.onPrimary} />} onPress={() => deliver.mutate(undefined)} loading={deliver.isPending} disabled={busy} />
        ) : null}
      </Row>
      {canPay ? <Button variant="success" label={tr('jobs.actions.close')} icon={<Wallet size={18} color={t.scheme === 'dark' ? '#0B1F12' : '#fff'} />} onPress={() => setPayOpen(true)} disabled={busy} /> : null}
    </View>
  ) : null;

  return (
    <Screen
      header={<Header title={d.plate} subtitle={d.customer_name} />}
      refreshing={job.isRefetching}
      onRefresh={() => void job.refetch()}
      footer={actions && (status === 'in_progress' || status === 'ready' || canPay) ? actions : undefined}
    >
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
          <PlateBadge plate={d.plate} size="lg" />
          <Txt variant="title" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt.money(d.total_amount, d.currency)}
          </Txt>
        </Row>
        <Row gap={t.spacing.sm} wrap>
          <JobStatusBadge status={d.status} />
          <PaymentBadge status={d.payment_status} />
        </Row>
        <ServiceTags services={d.lines.map((l) => ({ uuid: l.service_uuid, name: l.name, color: '' }))} max={6} />
      </Card>

      <LiveActivityCard job={d} />

      <Section title={tr('jobs.detail.info')} action={canEdit ? { label: tr('jobs.actions.edit_notes'), onPress: () => setNotesOpen(true) } : undefined}>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('jobs.customer')} value={d.customer_name} />
          <InfoRow label={tr('jobs.customer_phone')} value={d.customer_phone} />
          <InfoRow label={tr('jobs.vehicle')} value={d.vehicle_label} />
          <InfoRow label={tr('jobs.assignee')} value={d.assignee_name || tr('jobs.assignee_none')} />
          <InfoRow label={tr('jobs.started_at')} value={fmt.dateTime(d.started_at)} />
          {d.completed_at ? <InfoRow label={tr('jobs.completed_at')} value={fmt.dateTime(d.completed_at)} /> : null}
          {d.paid_at ? <InfoRow label={tr('jobs.paid_at')} value={fmt.dateTime(d.paid_at)} /> : null}
          <InfoRow label={tr('jobs.notes')} value={d.notes || '—'} last />
        </Card>
      </Section>

      <Section title={tr('jobs.detail.lines')}>
        <Group>
          {d.lines.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('jobs.detail.lines_empty')}
            </Txt>
          ) : (
            d.lines.map((l, i) => (
              <View key={l.uuid} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg, borderBottomWidth: i === d.lines.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{l.name}</Txt>
                  <Txt variant="caption" tone="secondary">
                    {fmt.number(l.qty)} × {fmt.money(l.unit_price, l.currency)} · KDV %{fmt.number(l.vat_rate)}
                  </Txt>
                </View>
                <Txt variant="mono">{fmt.money(l.line_total, l.currency)}</Txt>
              </View>
            ))
          )}
        </Group>
      </Section>

      <ConsumptionsSection job={d} canWrite={canWrite} />

      <JobContractsSection jobUuid={d.uuid} canCreate={status !== 'cancelled' && status !== 'voided'} />

      <Section title={tr('jobs.detail.payments')}>
        <Group>
          {d.payments.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('jobs.detail.payments_empty')}
            </Txt>
          ) : (
            d.payments.map((p, i) => (
              <View key={p.uuid} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg, borderBottomWidth: i === d.payments.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={t.spacing.sm}>
                    <Txt variant="bodyStrong">{tr(`jobs.payment_method.${p.method}`)}</Txt>
                    <Badge size="sm" tone={p.status === 'posted' ? 'success' : 'danger'} label={tr(`jobs.payment_status.${p.status}`)} />
                  </Row>
                  <Txt variant="caption" tone="secondary">
                    {fmt.dateTime(p.created_at)}
                    {p.finance_account_name ? ` · ${p.finance_account_name}` : ''}
                  </Txt>
                </View>
                <Txt variant="mono" style={p.status === 'void' ? { textDecorationLine: 'line-through' } : undefined}>
                  {fmt.money(p.amount, p.currency)}
                </Txt>
              </View>
            ))
          )}
        </Group>
      </Section>

      {canCancel || showVoid ? (
        <View style={{ gap: t.spacing.sm }}>
          {canCancel ? (
            <Button
              variant="outline"
              label={tr('jobs.actions.cancel')}
              icon={<Ban size={18} color={t.colors.danger} />}
              disabled={busy}
              onPress={async () => {
                if (await confirm({ title: tr('jobs.cancel.title'), message: tr('jobs.cancel.description'), confirmLabel: tr('jobs.cancel.confirm'), destructive: true })) cancel.mutate(undefined);
              }}
            />
          ) : null}
          {showVoid ? (
            <Button
              variant="danger"
              label={tr('jobs.actions.void')}
              icon={<Undo2 size={18} color="#fff" />}
              disabled={busy}
              onPress={async () => {
                if (await confirm({ title: tr('jobs.void.title'), message: tr('jobs.void.description'), confirmLabel: tr('jobs.void.confirm'), destructive: true })) voidJob.mutate(undefined);
              }}
            />
          ) : null}
        </View>
      ) : null}

      <NotesSheet job={d} visible={notesOpen} onClose={() => setNotesOpen(false)} />
      <CloseJobSheet job={payOpen ? d : null} visible={payOpen} onClose={() => setPayOpen(false)} />
    </Screen>
  );
}

// ─── Notes / assignee ──────────────────────────────────────────────────────

function NotesSheet({ job, visible, onClose }: { job: JobDetail; visible: boolean; onClose: () => void }) {
  const { t: tr } = useLocale();
  const staff = useStaffOptions(visible);
  const [notes, setNotes] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null | undefined>(undefined);
  const currentNotes = notes ?? job.notes;
  const currentAssignee = assignee === undefined ? (job.assignee_uuid ?? '') : (assignee ?? '');
  const dismiss = () => {
    setNotes(null);
    setAssignee(undefined);
    onClose();
  };
  const save = useApiMutation({
    key: 'jobs.patch',
    fn: () => jobsService.patch(job.uuid, { notes: currentNotes, assignee_uuid: currentAssignee || null }),
    invalidate: [qk.jobs],
    success: tr('jobs.toast.updated'),
    onSuccess: dismiss,
  });
  return (
    <Sheet
      visible={visible}
      onClose={dismiss}
      title={tr('jobs.actions.edit_notes')}
      footer={<Button label={save.isPending ? tr('common.saving') : tr('common.save')} loading={save.isPending} onPress={() => save.mutate(undefined)} size="lg" />}
    >
      <SelectField
        label={tr('jobs.assignee')}
        placeholder={tr('jobs.pick_assignee')}
        value={currentAssignee}
        onChange={(v) => setAssignee(v ?? null)}
        options={[{ value: '', label: tr('jobs.assignee_none') }, ...(staff.data?.items ?? []).map((s) => ({ value: s.uuid, label: s.label, description: s.email }))]}
        loading={staff.isLoading}
      />
      <TextField label={tr('jobs.notes')} value={currentNotes} onChangeText={setNotes} multiline />
    </Sheet>
  );
}

// ─── Consumptions (products used on the job) ───────────────────────────────

function ConsumptionsSection({ job, canWrite }: { job: JobDetail; canWrite: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const editable = canWrite && job.status !== 'cancelled' && job.status !== 'voided';
  const [addOpen, setAddOpen] = useState(false);
  const [product, setProduct] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const products = useProducts({ is_active: 'true' });
  const inv = [qk.jobs, qk.catalog];
  const add = useApiMutation({
    key: 'jobs.consumption.add',
    fn: () => jobsService.addConsumption(job.uuid, { product_uuid: product!, qty: qty.replace(',', '.') }),
    invalidate: inv,
    onSuccess: () => {
      setAddOpen(false);
      setProduct(null);
      setQty('1');
    },
  });
  const update = useApiMutation({ key: 'jobs.consumption.update', fn: (v: { id: string; qty: string }) => jobsService.updateConsumption(job.uuid, v.id, v.qty), invalidate: inv, toastValidation: true });
  const remove = useApiMutation({ key: 'jobs.consumption.delete', fn: (cid: string) => jobsService.deleteConsumption(job.uuid, cid), invalidate: inv, toastValidation: true });

  const rows = job.consumptions.filter((c) => !c.reverted || job.status === 'cancelled' || job.status === 'voided');
  const serviceTotal = toNumber(job.total_amount);
  const material = toNumber(job.material_cost);
  const margin = serviceTotal - material;
  const productOptions = useMemo(
    () =>
      (products.data?.items ?? []).map((p) => ({
        value: p.uuid,
        label: p.name,
        description: p.track_stock ? `${fmt.number(p.stock_quantity)} ${tr(`catalog.products.units.${p.unit}`)} · ${fmt.money(p.cost_price)}` : fmt.money(p.cost_price),
      })),
    [products.data, fmt, tr],
  );

  return (
    <Section title={tr('jobs.consumptions.title')} action={editable ? { label: tr('jobs.consumptions.add'), onPress: () => setAddOpen(true) } : undefined}>
      <Txt variant="caption" tone="secondary" style={{ marginTop: -4 }}>
        {tr('jobs.consumptions.hint')}
      </Txt>
      <Group>
        {rows.length === 0 ? (
          <EmptyState icon={<PackagePlus size={24} color={t.colors.textMuted} />} title={tr('jobs.consumptions.empty')} description="" />
        ) : (
          rows.map((c, i) => (
            <View key={c.uuid} style={{ padding: t.spacing.lg, gap: t.spacing.sm, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
              <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong" tone={c.reverted ? 'muted' : 'default'} style={c.reverted ? { textDecorationLine: 'line-through' } : undefined}>
                    {c.name}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {c.service_name ? tr('jobs.consumptions.from_recipe', { service: c.service_name }) : tr('jobs.consumptions.added_by_hand')}
                    {!c.stock_applied ? ` · ${tr('jobs.consumptions.untracked')}` : ''}
                    {c.reverted ? ` · ${tr('jobs.consumptions.reverted')}` : ''}
                  </Txt>
                </View>
                <Txt variant="mono">{fmt.money(c.total_cost)}</Txt>
              </Row>
              <Row gap={t.spacing.sm}>
                <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
                  {fmt.number(c.qty, 3)} {tr(`catalog.products.units.${c.unit}`)} × {fmt.money(c.unit_cost)}
                </Txt>
                {editable && !c.reverted ? (
                  <Row gap={6}>
                    <QtyButton
                      label="-"
                      icon={<Minus size={14} color={t.colors.text} />}
                      disabled={toNumber(c.qty) <= 1 || update.isPending}
                      onPress={() => update.mutate({ id: c.uuid, qty: String(Math.max(1, toNumber(c.qty) - 1)) })}
                    />
                    <QtyButton label="+" icon={<Plus size={14} color={t.colors.text} />} disabled={update.isPending} onPress={() => update.mutate({ id: c.uuid, qty: String(toNumber(c.qty) + 1) })} />
                    <QtyButton label={tr('common.delete')} icon={<Trash2 size={14} color={t.colors.danger} />} disabled={remove.isPending} onPress={() => remove.mutate(c.uuid)} />
                  </Row>
                ) : null}
              </Row>
            </View>
          ))
        )}
      </Group>
      <Card style={{ gap: t.spacing.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="caption" tone="secondary">{tr('jobs.consumptions.service_total')}</Txt>
          <Txt variant="mono">{fmt.money(serviceTotal)}</Txt>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="caption" tone="secondary">{tr('jobs.consumptions.material_cost')}</Txt>
          <Txt variant="mono" tone="danger">
            -{fmt.money(material)}
          </Txt>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="bodyStrong">{tr('jobs.consumptions.margin')}</Txt>
          <Txt variant="mono" tone={margin >= 0 ? 'success' : 'danger'}>
            {fmt.money(margin)}
          </Txt>
        </Row>
      </Card>

      <Sheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title={tr('jobs.consumptions.add')}
        footer={<Button label={tr('jobs.consumptions.add')} onPress={() => add.mutate(undefined)} loading={add.isPending} disabled={!product || !(toNumber(qty.replace(',', '.')) > 0)} size="lg" />}
      >
        <SelectField label={tr('jobs.consumptions.pick_product')} value={product} onChange={setProduct} options={productOptions} searchable loading={products.isLoading} />
        <TextField label={tr('jobs.consumptions.qty')} value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
      </Sheet>
    </Section>
  );
}

function QtyButton({ icon, onPress, disabled, label }: { icon: React.ReactNode; onPress: () => void; disabled?: boolean; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: t.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.colors.surface,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      {icon}
    </Pressable>
  );
}

