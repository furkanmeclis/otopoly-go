/** Lead detail — web `/t/[slug]/leads/[uuid]` (`features/leads/components/lead-detail-page.tsx`). */
import { router, useLocalSearchParams } from 'expo-router';
import { Check, FilePlus2, ListTodo, MessageSquarePlus, MoreHorizontal, Pencil, Phone, RotateCcw, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Badge, Button, Card, DateField, EmptyState, Group, Header, IconButton, InfoRow, ListRow, ListSkeleton, PlateBadge, Row, Screen, Section, TextField, Txt, useConfirm } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { QuotesModuleGate } from '@/features/billing/components/module-gate';
import { P } from '@/features/auth/permissions';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { ActionMenu, Chip, ChipRow, Notice, Stepper } from '@/features/leads/components/crm-ui';
import { LeadTodoSheet, LostSheet } from '@/features/leads/components/lead-sheets';
import { TemperatureToggle } from '@/features/leads/components/temperature-toggle';
import { LEAD_STEPS, leadStatusTone, nextLeadStatus } from '@/features/leads/lib/lead-ui';
import { useLeadMutations, useLeadsAccess } from '@/features/leads/queries';
import type { LeadDetail, LeadEvent, PatchLeadInput } from '@/features/leads/types';
import { useLead } from '@/features/queries';
import { quoteStatusTone } from '@/features/quotes/lib/quote-ui';
import { LinkedTodos } from '@/features/todos/components/linked-todos';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function LeadDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.leadsRead} title={tr('leads.title')}>
      <QuotesModuleGate area="leads" title={tr('leads.title')}>
        <LeadDetailContent />
      </QuotesModuleGate>
    </RequirePermission>
  );
}

function LeadDetailContent() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const access = useLeadsAccess();
  const confirm = useConfirm();
  const query = useLead(id);
  const m = useLeadMutations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('leads.back')} />}>
        <ListSkeleton rows={4} height={100} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen header={<Header title={tr('leads.back')} />} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
        <EmptyState title={tr('leads.not_found')} action={<Button variant="outline" size="sm" label={tr('leads.back')} onPress={() => router.replace('/leads')} />} />
      </Screen>
    );
  }
  const lead = query.data;
  const open = lead.status !== 'won' && lead.status !== 'lost';
  const next = nextLeadStatus(lead.status);
  const patch = (body: PatchLeadInput) => m.patch.mutate({ uuid: lead.uuid, body });
  const newQuote = () => router.push({ pathname: '/quotes/form', params: { lead: lead.uuid, customer: lead.customer_uuid } });
  const call = () => Linking.openURL(`tel:${lead.customer_phone.replace(/\s/g, '')}`);
  const stepIdx = LEAD_STEPS.indexOf(lead.status);
  const followColor = lead.follow_up_state === 'overdue' ? 'danger' : lead.follow_up_state === 'today' ? 'warning' : 'default';

  return (
    <Screen
      header={
        <Header
          title={lead.customer_name}
          subtitle={`${tr(`leads.source.${lead.source}`)} · ${fmt.dateTime(lead.created_at)}${lead.created_by_name ? ` · ${lead.created_by_name}` : ''}`}
          right={access.canWrite ? <IconButton label={tr('leads.more_actions')} icon={<MoreHorizontal size={20} color={t.colors.text} />} onPress={() => setMenuOpen(true)} /> : undefined}
        />
      }
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.sm} wrap>
          <Badge tone={leadStatusTone(lead.status)} label={tr(`leads.status.${lead.status}`)} />
          {access.canWrite ? <TemperatureToggle value={lead.temperature} onChange={(temperature) => patch({ temperature })} disabled={m.patch.isPending} /> : null}
        </Row>
        <Txt tone={lead.interest ? 'default' : 'muted'}>{lead.interest || tr('leads.no_interest')}</Txt>
        <Stepper
          steps={LEAD_STEPS}
          current={lead.status}
          doneUntil={lead.status === 'lost' ? -1 : stepIdx}
          successStep="won"
          muted={lead.status === 'lost'}
          label={(s) => tr(`leads.status.${s}`)}
          onStep={access.canWrite ? (status) => patch({ status }) : undefined}
        />
        {lead.status === 'lost' && lead.lost_reason ? <Notice tone="danger">{`${tr('leads.lost_reason')}: ${lead.lost_reason}`}</Notice> : null}
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
        {lead.customer_phone ? <Button size="sm" variant="outline" label={tr('leads.actions.call')} icon={<Phone size={16} color={t.colors.text} />} onPress={call} /> : null}
        {access.canWrite && next ? <Button size="sm" variant="outline" label={tr(`leads.advance.${next}`)} icon={<Check size={16} color={t.colors.text} />} onPress={() => patch({ status: next })} /> : null}
        {access.canQuote ? <Button size="sm" label={tr('leads.actions.quote')} icon={<FilePlus2 size={16} color={t.colors.onPrimary} />} onPress={newQuote} /> : null}
        {access.canTodo ? <Button size="sm" variant="outline" label={tr('leads.actions.todo')} icon={<ListTodo size={16} color={t.colors.text} />} onPress={() => setTodoOpen(true)} /> : null}
      </ScrollView>

      <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
        <InfoRow label={tr('leads.fields.phone')}>
          {lead.customer_phone ? (
            <Pressable onPress={call} accessibilityRole="link">
              <Txt tone="primary" variant="bodyStrong">
                {lead.customer_phone}
              </Txt>
            </Pressable>
          ) : (
            <Txt variant="bodyStrong">—</Txt>
          )}
        </InfoRow>
        <InfoRow label={tr('leads.fields.customer')}>
          <Pressable onPress={() => router.push(`/customers/${lead.customer_uuid}`)} accessibilityRole="link" style={{ flexShrink: 1 }}>
            <Txt tone="primary" variant="bodyStrong" numberOfLines={1}>
              {lead.customer_name}
            </Txt>
          </Pressable>
        </InfoRow>
        <InfoRow label={tr('leads.fields.vehicle')}>{lead.vehicle_plate ? <PlateBadge plate={lead.vehicle_plate} size="sm" /> : <Txt variant="bodyStrong">{lead.vehicle_text || '—'}</Txt>}</InfoRow>
        {access.canWrite && open ? (
          <View style={{ paddingVertical: t.spacing.md, gap: t.spacing.sm, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <DateField label={tr('leads.fields.follow_up_date')} value={lead.follow_up_date} onChange={(v) => patch({ follow_up_date: v ?? '' })} allowClear error={lead.follow_up_state === 'overdue' ? ' ' : undefined} />
            <ChipRow>
              {[
                { label: tr('leads.follow.today'), days: 0 },
                { label: tr('leads.follow.tomorrow'), days: 1 },
                { label: tr('leads.follow.week'), days: 7 },
              ].map((o) => (
                <Chip key={o.days} label={o.label} onPress={() => patch({ follow_up_date: shiftDate(localToday(), o.days) })} />
              ))}
            </ChipRow>
          </View>
        ) : (
          <InfoRow label={tr('leads.fields.follow_up_date')}>
            <Txt variant="bodyStrong" tone={followColor}>
              {lead.follow_up_date ? fmt.date(`${lead.follow_up_date}T12:00:00`) : '—'}
            </Txt>
          </InfoRow>
        )}
        <InfoRow label={tr('leads.fields.assignee')} value={lead.assignee?.label ?? tr('leads.unassigned')} last={!lead.notes} />
        {lead.notes ? (
          <View style={{ paddingVertical: t.spacing.md, gap: 4 }}>
            <Txt variant="caption" tone="secondary">
              {tr('leads.fields.notes')}
            </Txt>
            <Txt selectable>{lead.notes}</Txt>
          </View>
        ) : null}
      </Card>

      <Section title={tr('leads.quotes')} action={access.canQuote ? { label: tr('leads.actions.quote'), onPress: newQuote } : undefined}>
        <Group>
          {lead.quotes.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('leads.no_quotes')}
            </Txt>
          ) : (
            lead.quotes.map((q, i) => (
              <ListRow
                key={q.uuid}
                title={q.number}
                subtitle={fmt.money(q.grand_total, q.currency)}
                right={<Badge size="sm" tone={quoteStatusTone(q.status)} label={tr(`quotes.status.${q.status}`)} />}
                onPress={() => router.push(`/quotes/${q.uuid}`)}
                last={i === lead.quotes.length - 1}
              />
            ))
          )}
        </Group>
      </Section>

      <LinkedTodos
        lead={lead.uuid}
        onAdd={access.canTodo ? () => setTodoOpen(true) : undefined}
        defaults={{ lead: { uuid: lead.uuid, label: lead.customer_name }, customer: { uuid: lead.customer_uuid, label: lead.customer_name } }}
      />

      <Timeline lead={lead} canWrite={access.canWrite} />

      <ActionMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={tr('leads.more_actions')}
        actions={[
          { key: 'edit', label: tr('leads.actions.edit'), icon: <Pencil size={18} color={t.colors.text} />, onPress: () => router.push({ pathname: '/leads/form', params: { id: lead.uuid } }) },
          open
            ? { key: 'lost', label: tr('leads.actions.mark_lost'), icon: <X size={18} color={t.colors.text} />, onPress: () => setLostOpen(true) }
            : { key: 'reopen', label: tr('leads.actions.reopen'), icon: <RotateCcw size={18} color={t.colors.text} />, onPress: () => patch({ status: 'contacted' }) },
          {
            key: 'delete',
            label: tr('leads.actions.delete'),
            destructive: true,
            icon: <Trash2 size={18} color={t.colors.danger} />,
            onPress: async () => {
              if (await confirm({ title: tr('leads.confirm_delete'), destructive: true, confirmLabel: tr('common.delete') })) {
                m.remove.mutate(lead.uuid, { onSuccess: () => router.replace('/leads') });
              }
            },
          },
        ]}
      />
      <LeadTodoSheet lead={lead} visible={todoOpen} onClose={() => setTodoOpen(false)} />
      <LostSheet
        visible={lostOpen}
        onClose={() => setLostOpen(false)}
        pending={m.patch.isPending}
        onConfirm={(reason) => m.patch.mutate({ uuid: lead.uuid, body: { status: 'lost', lost_reason: reason } }, { onSuccess: () => setLostOpen(false) })}
      />
    </Screen>
  );
}

function eventText(e: LeadEvent, t: (k: string, v?: Record<string, string | number>) => string) {
  const val = (kind: string, v: string) => {
    if (!v) return '—';
    if (kind === 'status_changed') return t(`leads.status.${v}`);
    if (kind === 'temperature_changed') return t(`leads.temperature.${v}`);
    if (kind === 'source_changed') return t(`leads.source.${v}`);
    return v;
  };
  switch (e.kind) {
    case 'status_changed':
    case 'temperature_changed':
    case 'source_changed':
    case 'assignee_changed':
    case 'follow_up_changed':
      return t(`leads.events.${e.kind}`, { from: val(e.kind, e.from_value), to: val(e.kind, e.to_value) });
    case 'created':
      return t('leads.events.created', { source: val('source_changed', e.to_value) });
    default:
      return t(`leads.events.${e.kind}`, { ref: e.ref_label });
  }
}

function Timeline({ lead, canWrite }: { lead: LeadDetail; canWrite: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { addNote } = useLeadMutations();
  const [note, setNote] = useState('');
  const submit = () => {
    const body = note.trim();
    if (!body) return;
    addNote.mutate({ uuid: lead.uuid, body }, { onSuccess: () => setNote('') });
  };
  const openRef = (e: LeadEvent) => {
    if (!e.ref_uuid) return undefined;
    if (e.ref_type === 'quote') return () => router.push(`/quotes/${e.ref_uuid}`);
    if (e.ref_type === 'job') return () => router.push(`/jobs/${e.ref_uuid}`);
    if (e.ref_type === 'todo') return () => router.push({ pathname: '/todos', params: { todo: e.ref_uuid! } });
    return undefined;
  };
  return (
    <Section title={tr('leads.timeline')}>
      {canWrite ? (
        <Card style={{ gap: t.spacing.sm }}>
          <TextField value={note} onChangeText={setNote} placeholder={tr('mobile.crm.note_placeholder')} multiline accessibilityLabel={tr('leads.actions.add_note')} />
          <Button size="sm" label={tr('leads.actions.add_note')} icon={<MessageSquarePlus size={16} color={t.colors.onPrimary} />} disabled={!note.trim()} loading={addNote.isPending} onPress={submit} style={{ alignSelf: 'flex-end' }} />
        </Card>
      ) : null}
      <Card style={{ gap: t.spacing.lg }}>
        {lead.events.map((e) => {
          const isNote = e.kind === 'note';
          const onRef = openRef(e);
          const dot = isNote ? t.colors.warning : e.kind.startsWith('quote') ? t.colors.primary : t.colors.borderStrong;
          return (
            <View key={e.uuid} style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: dot }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={6} wrap style={{ justifyContent: 'space-between' }}>
                  <Txt variant={isNote ? 'bodyStrong' : 'body'} style={{ flexShrink: 1 }}>
                    {isNote ? e.actor_name || tr('leads.someone') : eventText(e, tr)}
                    {onRef && e.ref_label && !isNote ? (
                      <Txt tone="primary" variant="mono" onPress={onRef} accessibilityRole="link">
                        {` ${e.ref_label}`}
                      </Txt>
                    ) : null}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {fmt.relative(e.created_at)}
                  </Txt>
                </Row>
                {isNote ? (
                  <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md, padding: t.spacing.md }}>
                    <Txt selectable>{e.body}</Txt>
                  </View>
                ) : e.body ? (
                  <Txt variant="caption" tone="secondary">
                    {e.body}
                  </Txt>
                ) : null}
                {!isNote && e.actor_name ? (
                  <Txt variant="caption" tone="muted">
                    {e.actor_name}
                  </Txt>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>
    </Section>
  );
}
