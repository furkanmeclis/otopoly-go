/** Quote detail — web `/t/[slug]/quotes/[uuid]` (`features/quotes/components/quote-detail-page.tsx`). `?send=1` opens the send sheet. */
import { router, useLocalSearchParams } from 'expo-router';
import { BellRing, CalendarClock, Check, Copy, CopyPlus, Download, ExternalLink, Eye, Hammer, MoreHorizontal, Pencil, RotateCw, Send, X } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Badge, Button, Card, Divider, EmptyState, Group, Header, IconButton, InfoRow, ListRow, ListSkeleton, PlateBadge, Row, Screen, Section, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { QuotesModuleGate } from '@/features/billing/components/module-gate';
import { P } from '@/features/auth/permissions';
import { localToday } from '@/features/jobs/lib/job-ui';
import { ActionMenu, Notice, Stepper, type MenuAction } from '@/features/leads/components/crm-ui';
import { useQuote } from '@/features/queries';
import { ConvertQuoteSheet, DecisionSheet, RemindersSheet, SendQuoteSheet, useCopyShareLink, useQuotePdf, type Decision } from '@/features/quotes/components/quote-sheets';
import { QUOTE_STEPS, daysUntil, deliveryErrorText, isOpenQuote, quoteStatusTone } from '@/features/quotes/lib/quote-ui';
import { useQuoteMutations, useQuotesAccess } from '@/features/quotes/queries';
import type { QuoteDetail } from '@/features/quotes/types';
import { LinkedTodos } from '@/features/todos/components/linked-todos';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function QuoteDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.quotesRead} title={tr('quotes.title')}>
      <QuotesModuleGate area="quotes" title={tr('quotes.title')}>
        <QuoteDetailContent />
      </QuotesModuleGate>
    </RequirePermission>
  );
}

function QuoteDetailContent() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id, send } = useLocalSearchParams<{ id: string; send?: string }>();
  const access = useQuotesAccess();
  const query = useQuote(id);
  const m = useQuoteMutations();
  const copy = useCopyShareLink();
  const pdf = useQuotePdf();
  // "Save & send" from the editor lands here with ?send=1.
  const [sendOpen, setSendOpen] = useState(send === '1');
  const [convertOpen, setConvertOpen] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('quotes.title')} />}>
        <ListSkeleton rows={4} height={110} />
      </Screen>
    );
  }
  if (!query.data) {
    return (
      <Screen header={<Header title={tr('quotes.title')} />} refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
        <EmptyState title={tr('quotes.not_found')} action={<Button variant="outline" size="sm" label={tr('quotes.title')} onPress={() => router.replace('/quotes')} />} />
      </Screen>
    );
  }
  const q = query.data;
  const money = (v: string | number) => fmt.money(v, q.currency);
  const shared = q.status !== 'draft';
  const open = isOpenQuote(q.status);
  const days = q.valid_until ? daysUntil(q.valid_until, localToday()) : null;
  const canConvert = access.canConvert && q.can_convert;
  const allowed = q.allowed_statuses;
  const closeSend = () => {
    setSendOpen(false);
    if (send) router.setParams({ send: undefined });
  };
  const duplicate = () => m.duplicate.mutate(q.uuid, { onSuccess: (d) => router.push({ pathname: '/quotes/form', params: { id: d.uuid } }) });

  const primary = q.job_uuid ? (
    <Button label={tr('quotes.actions.open_job')} icon={<Hammer size={18} color={t.colors.onPrimary} />} onPress={() => router.push(`/jobs/${q.job_uuid}`)} style={{ flex: 1 }} />
  ) : q.status === 'draft' && access.canWrite ? (
    <Button label={tr('quotes.actions.send')} icon={<Send size={18} color={t.colors.onPrimary} />} onPress={() => setSendOpen(true)} style={{ flex: 1 }} />
  ) : canConvert ? (
    <Button label={tr('quotes.actions.convert')} icon={<Hammer size={18} color={t.colors.onPrimary} />} onPress={() => setConvertOpen(true)} style={{ flex: 1 }} />
  ) : null;

  const menu: MenuAction[] = [
    { key: 'pdf', label: tr('quotes.actions.pdf'), icon: <Download size={18} color={t.colors.text} />, onPress: () => pdf.share(q) },
    ...(shared
      ? [
          { key: 'copy', label: tr('quotes.actions.copy_link'), icon: <Copy size={18} color={t.colors.text} />, onPress: () => copy(q.share_url) },
          { key: 'open', label: tr('quotes.actions.open_link'), icon: <ExternalLink size={18} color={t.colors.text} />, onPress: () => Linking.openURL(q.share_url) },
        ]
      : []),
    ...(access.canWrite && q.can_edit ? [{ key: 'edit', label: tr('quotes.actions.edit'), icon: <Pencil size={18} color={t.colors.text} />, onPress: () => router.push({ pathname: '/quotes/form', params: { id: q.uuid } }) }] : []),
    ...(access.canWrite && q.can_send && q.status !== 'draft' ? [{ key: 'resend', label: tr('quotes.actions.resend'), icon: <Send size={18} color={t.colors.text} />, onPress: () => setSendOpen(true) }] : []),
    ...(canConvert && q.status !== 'draft' ? [{ key: 'convert', label: tr('quotes.actions.convert'), icon: <Hammer size={18} color={t.colors.text} />, onPress: () => setConvertOpen(true) }] : []),
    ...(access.canWrite && allowed.includes('accepted') ? [{ key: 'accept', label: tr('quotes.actions.mark_accepted'), icon: <Check size={18} color={t.colors.success} />, onPress: () => setDecision('accepted') }] : []),
    ...(access.canWrite && allowed.includes('rejected') ? [{ key: 'reject', label: tr('quotes.actions.mark_rejected'), icon: <X size={18} color={t.colors.text} />, onPress: () => setDecision('rejected') }] : []),
    ...(access.canWrite && allowed.includes('cancelled') ? [{ key: 'cancel', label: tr('quotes.actions.cancel'), destructive: true, icon: <X size={18} color={t.colors.danger} />, onPress: () => setDecision('cancelled') }] : []),
    ...(access.canWrite ? [{ key: 'duplicate', label: tr('quotes.actions.duplicate'), icon: <CopyPlus size={18} color={t.colors.text} />, onPress: duplicate }] : []),
  ];

  const decidedAt = q.status === 'accepted' ? q.accepted_at : q.rejected_at;
  const validTone = open && days !== null && days < 0 ? 'danger' : open && days !== null && days <= 3 ? 'warning' : 'muted';

  return (
    <Screen
      header={
        <Header
          title={q.number}
          subtitle={q.customer_name}
          right={<IconButton label={tr('quotes.more_actions')} icon={<MoreHorizontal size={20} color={t.colors.text} />} onPress={() => setMenuOpen(true)} />}
        />
      }
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
      footer={
        primary || (access.canWrite && q.can_edit) ? (
          <Row gap={t.spacing.sm}>
            {access.canWrite && q.can_edit ? (
              <Button variant="outline" label={tr('quotes.actions.edit')} icon={<Pencil size={16} color={t.colors.text} />} onPress={() => router.push({ pathname: '/quotes/form', params: { id: q.uuid } })} style={primary ? undefined : { flex: 1 }} />
            ) : null}
            {primary}
          </Row>
        ) : undefined
      }
    >
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.sm} wrap>
          <Badge tone={quoteStatusTone(q.status)} label={tr(`quotes.status.${q.status}`)} />
          {q.view_count > 0 ? <Badge size="sm" label={String(q.view_count)} icon={<Eye size={11} color={t.colors.neutral} />} /> : null}
        </Row>
        <View style={{ gap: 4 }}>
          <Pressable onPress={() => router.push(`/customers/${q.customer_uuid}`)} accessibilityRole="link">
            <Txt variant="bodyStrong" tone="primary">
              {q.customer_name}
              {q.customer_phone ? <Txt tone="secondary">{` · ${q.customer_phone}`}</Txt> : null}
            </Txt>
          </Pressable>
          <Row gap={t.spacing.sm} wrap>
            {q.vehicle_plate ? <PlateBadge plate={q.vehicle_plate} size="sm" /> : null}
            {q.vehicle_label ? (
              <Txt variant="caption" tone="secondary">
                {q.vehicle_label}
              </Txt>
            ) : null}
            {q.lead_uuid ? (
              <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }} accessibilityRole="link" onPress={() => router.push(`/leads/${q.lead_uuid}`)}>
                {tr('quotes.from_lead')}
              </Txt>
            ) : null}
          </Row>
        </View>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Txt variant="caption" tone="secondary">
              {tr('quotes.fields.grand_total')}
            </Txt>
            <Txt variant="display" tone="primary" style={{ fontSize: 28 }}>
              {money(q.grand_total)}
            </Txt>
          </View>
          {q.valid_until ? (
            <Row gap={4}>
              <CalendarClock size={14} color={validTone === 'danger' ? t.colors.danger : validTone === 'warning' ? t.colors.warning : t.colors.textMuted} />
              <Txt variant="caption" tone={validTone}>
                {fmt.date(`${q.valid_until}T12:00:00`)}
                {open && days !== null ? ` · ${days < 0 ? tr('quotes.valid.past') : days === 0 ? tr('quotes.valid.today') : tr('quotes.valid.days', { days })}` : ''}
              </Txt>
            </Row>
          ) : null}
        </Row>
        <Stepper
          steps={QUOTE_STEPS}
          current={q.status}
          doneUntil={['rejected', 'expired', 'cancelled'].includes(q.status) ? -1 : QUOTE_STEPS.indexOf(q.status)}
          successStep="accepted"
          label={(s) => tr(`quotes.status.${s}`)}
        />
        {q.status === 'rejected' || q.status === 'expired' || q.status === 'cancelled' ? <Notice tone="danger">{tr(`quotes.terminal.${q.status}`)}</Notice> : null}
        {q.status === 'accepted' || q.status === 'rejected' ? (
          <Notice
            tone={q.status === 'accepted' ? 'success' : 'danger'}
            icon={q.status === 'accepted' ? <Check size={18} color={t.colors.success} /> : <X size={18} color={t.colors.danger} />}
            title={`${tr(`quotes.decision_banner.${q.status}`)}${decidedAt ? ` · ${fmt.dateTime(decidedAt)}` : ''}`}
          >
            {[q.decision_channel === 'public' ? tr('quotes.decided_by_customer') : '', q.decision_note ? `“${q.decision_note}”` : '', q.status === 'accepted' && !q.job_uuid && canConvert ? tr('quotes.decision_banner.convert_hint') : '']
              .filter(Boolean)
              .join(' ')}
          </Notice>
        ) : null}
      </Card>

      <Section title={tr('quotes.lines')}>
        <Group>
          {q.lines.map((l, i) => {
            const disc = toNumber(l.line_discount) + toNumber(l.quote_discount_share);
            return (
              <View key={l.uuid} style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, gap: 2, borderBottomWidth: i === q.lines.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
                <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {l.description}
                  </Txt>
                  <Txt variant="mono">{money(l.line_total)}</Txt>
                </Row>
                <Txt variant="caption" tone="secondary">
                  {`${fmt.number(l.quantity, 3)} ${l.unit} × ${money(l.unit_price)}`}
                  {disc > 0 ? ` · -${money(disc)}` : ''}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {`${tr(`quotes.line_type.${l.line_type}`)} · %${toNumber(l.vat_rate)} ${tr('quotes.fields.vat')}`}
                </Txt>
              </View>
            );
          })}
        </Group>
        <Card padded={false} style={{ paddingHorizontal: t.spacing.lg }}>
          <InfoRow label={tr('quotes.fields.subtotal')} value={money(q.subtotal)} />
          {toNumber(q.discount_total) > 0 ? <InfoRow label={tr('quotes.fields.discount_total')} value={`-${money(q.discount_total)}`} /> : null}
          <InfoRow label={q.prices_include_vat ? tr('quotes.fields.vat_included') : tr('quotes.fields.vat_total')} value={money(q.vat_total)} />
          <InfoRow label={tr('quotes.fields.grand_total')} last>
            <Txt variant="heading">{money(q.grand_total)}</Txt>
          </InfoRow>
        </Card>
        {q.notes || q.terms ? (
          <Card style={{ gap: t.spacing.md }}>
            {q.notes ? <TextBlock label={tr('quotes.fields.notes')} text={q.notes} /> : null}
            {q.notes && q.terms ? <Divider /> : null}
            {q.terms ? <TextBlock label={tr('quotes.fields.terms')} text={q.terms} /> : null}
          </Card>
        ) : null}
      </Section>

      <Deliveries q={q} canWrite={access.canWrite} onResend={() => setSendOpen(true)} onRetry={(deliveryUuid) => m.retry.mutate({ uuid: q.uuid, deliveryUuid })} retrying={m.retry.isPending} />

      <Section title={tr('quotes.reminders.title')} action={access.canWrite && open ? { label: tr('quotes.reminders.edit'), onPress: () => setRemindersOpen(true) } : undefined}>
        <Group>
          {q.reminders.length === 0 ? (
            <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
              {tr('quotes.reminders.empty')}
            </Txt>
          ) : (
            q.reminders.map((r, i) => (
              <ListRow
                key={r.uuid}
                left={<BellRing size={16} color={t.colors.textMuted} />}
                title={tr(`quotes.reminders.kind.${r.kind}`)}
                subtitle={`${fmt.dateTime(r.fire_at)}${r.error ? ` · ${deliveryErrorText(r.error, tr)}` : ''}`}
                value={tr(`quotes.reminders.status.${r.status}`)}
                disabled={r.status === 'cancelled'}
                chevron={false}
                last={i === q.reminders.length - 1}
              />
            ))
          )}
        </Group>
      </Section>

      <Section title={tr('quotes.history')}>
        <Card style={{ gap: t.spacing.md }}>
          {q.events.map((e) => (
            <View key={e.uuid} style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: t.colors.primary }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt>
                  {e.kind === 'status_changed' ? tr('quotes.events.status_changed', { to: tr(`quotes.status.${e.to_status}`) }) : tr(`quotes.events.${e.kind}`)}
                  {e.channel === 'public' ? <Txt tone="muted">{` · ${tr('quotes.events.by_customer')}`}</Txt> : e.channel === 'system' ? <Txt tone="muted">{` · ${tr('quotes.events.by_system')}`}</Txt> : null}
                </Txt>
                {e.body && e.kind !== 'converted' && e.kind !== 'reminders_set' ? (
                  <Txt variant="caption" tone="secondary">
                    {e.body}
                  </Txt>
                ) : null}
                <Txt variant="caption" tone="muted">
                  {fmt.relative(e.created_at)}
                  {e.actor_name ? ` · ${e.actor_name}` : ''}
                  {e.ip ? ` · ${e.ip}` : ''}
                </Txt>
              </View>
            </View>
          ))}
        </Card>
      </Section>

      <LinkedTodos
        quote={q.uuid}
        defaults={{
          quote: { uuid: q.uuid, label: `${q.number} · ${q.customer_name}` },
          customer: { uuid: q.customer_uuid, label: q.customer_name },
          ...(q.lead_uuid ? { lead: { uuid: q.lead_uuid, label: q.customer_name } } : {}),
        }}
      />

      <ActionMenu visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('quotes.more_actions')} actions={menu} />
      <SendQuoteSheet quote={q} visible={sendOpen && q.can_send && access.canWrite} onClose={closeSend} />
      <ConvertQuoteSheet quote={q} visible={convertOpen} onClose={() => setConvertOpen(false)} />
      <DecisionSheet
        status={decision}
        onClose={() => setDecision(null)}
        pending={m.setStatus.isPending}
        onConfirm={(status, note) => m.setStatus.mutate({ uuid: q.uuid, status, note }, { onSuccess: () => setDecision(null) })}
      />
      <RemindersSheet quote={q} visible={remindersOpen} onClose={() => setRemindersOpen(false)} />
    </Screen>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
      <Txt selectable>{text}</Txt>
    </View>
  );
}

function Deliveries({ q, canWrite, onResend, onRetry, retrying }: { q: QuoteDetail; canWrite: boolean; onResend: () => void; onRetry: (uuid: string) => void; retrying: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  return (
    <Section title={tr('quotes.deliveries.title')} action={canWrite && q.can_send && q.status !== 'draft' ? { label: tr('quotes.actions.resend'), onPress: onResend } : undefined}>
      <Group>
        {q.deliveries.length === 0 ? (
          <Txt tone="secondary" variant="caption" style={{ padding: t.spacing.lg }}>
            {tr('quotes.deliveries.empty')}
          </Txt>
        ) : (
          q.deliveries.map((d, i) => {
            const color = d.status === 'sent' ? t.colors.success : d.status === 'failed' ? t.colors.danger : t.colors.warning;
            const canRetry = d.status === 'failed' && canWrite && (q.status === 'sent' || q.status === 'viewed');
            return (
              <ListRow
                key={d.uuid}
                left={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />}
                title={`${tr(`quotes.deliveries.status.${d.status}`)} · ${d.channel}${d.recipient ? ` · ${d.recipient}` : ''}`}
                subtitle={[d.error ? deliveryErrorText(d.error, tr) : '', `${fmt.dateTime(d.last_attempt_at ?? d.created_at)} · ${tr('quotes.deliveries.attempts', { count: d.attempt_count })}`].filter(Boolean).join('\n')}
                right={canRetry ? <IconButton variant="ghost" label={tr('quotes.actions.retry')} disabled={retrying} icon={<RotateCw size={16} color={t.colors.primary} />} onPress={() => onRetry(d.uuid)} /> : undefined}
                chevron={false}
                last={i === q.deliveries.length - 1}
              />
            );
          })
        )}
      </Group>
    </Section>
  );
}
