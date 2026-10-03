import { useIsFocused } from 'expo-router';
import { Car, CheckCircle2, KeyRound, Wallet } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Avatar, Badge, Card, PlateBadge, Row, Txt } from '@/components/ui';
import { resolveServiceColor, serviceSwatch } from '@/features/catalog/lib/service-colors';
import type { Job, JobServiceTag } from '@/features/jobs/services/jobs.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

import { carryOverDay, isStale, localDateOf, minutesSince, statusTone } from '../lib/job-ui';

/**
 * Re-renders every 30 s so elapsed timers tick without refetching. Only while the screen is focused:
 * the tab screens using it stay mounted all session, and re-rendering their job lists in the background
 * is wasted work. Coming back refreshes `now` right away.
 */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const kick = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, [intervalMs, focused]);
  return now;
}

export function useFormatElapsed() {
  const { t } = useLocale();
  return (minutes: number) => {
    if (minutes < 60) return t('jobs.elapsed.minutes', { m: minutes });
    if (minutes >= 24 * 60) {
      const d = Math.floor(minutes / (24 * 60));
      const h = Math.floor((minutes % (24 * 60)) / 60);
      return h === 0 ? t('jobs.elapsed.days', { d }) : t('jobs.elapsed.days_hours', { d, h });
    }
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? t('jobs.elapsed.hours', { h }) : t('jobs.elapsed.hours_minutes', { h, m });
  };
}

export function JobElapsed({ startedAt, now, stale }: { startedAt: string; now: number; stale?: boolean }) {
  const format = useFormatElapsed();
  return (
    <Txt variant="caption" tone={stale ? 'warning' : 'muted'} style={{ fontWeight: stale ? '700' : '500', fontVariant: ['tabular-nums'] }}>
      {format(minutesSince(startedAt, now))}
    </Txt>
  );
}

export function JobStatusBadge({ status, size = 'md' }: { status: Job['status']; size?: 'sm' | 'md' }) {
  const { t } = useLocale();
  return <Badge size={size} tone={statusTone(status)} label={t(`jobs.status.${status}`)} />;
}

export function PaymentBadge({ status, size = 'md' }: { status: Job['payment_status']; size?: 'sm' | 'md' }) {
  const { t } = useLocale();
  return <Badge size={size} tone={status === 'paid' ? 'success' : 'warning'} label={t(`jobs.payment.${status}`)} />;
}

export function ServiceTags({ services, max = 3 }: { services?: JobServiceTag[] | null; max?: number }) {
  const t = useTheme();
  if (!services?.length) return null;
  const shown = services.slice(0, max);
  return (
    <Row gap={6} wrap>
      {shown.map((s, i) => {
        const sw = serviceSwatch(s.color, s.name, t.scheme);
        return (
          <View key={`${s.uuid ?? s.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: sw.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sw.solid }} />
            <Txt style={{ fontSize: 11, fontWeight: '700', color: sw.text }} numberOfLines={1}>
              {s.name}
            </Txt>
          </View>
        );
      })}
      {services.length > max ? <Txt variant="caption" tone="muted">+{services.length - max}</Txt> : null}
    </Row>
  );
}

/** Coloured top stripe, one segment per service (web JobServiceStripe). */
function ServiceStripe({ services }: { services?: JobServiceTag[] | null }) {
  if (!services?.length) return null;
  return (
    <View style={{ flexDirection: 'row', height: 4, position: 'absolute', top: 0, left: 0, right: 0 }}>
      {services.map((s, i) => {
        const key = resolveServiceColor(s.color, s.name);
        return <View key={`${key}-${i}`} style={{ flex: 1, backgroundColor: serviceSwatch(key, s.name, 'light').solid }} />;
      })}
    </View>
  );
}

export type JobQuickAction = 'ready' | 'deliver' | 'pay';

/** Board card — mirrors web JobBoardCard: plate, carry-over, amount, services, assignee, timer, quick action. */
export function JobCard({
  job,
  now,
  canWrite,
  pending,
  onPress,
  onAction,
}: {
  job: Job;
  now: number;
  canWrite: boolean;
  pending?: boolean;
  onPress: () => void;
  onAction?: (job: Job, action: JobQuickAction) => void;
}) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const stale = isStale(job, now);
  const workDay = carryOverDay(job);
  const spanDays =
    job.status === 'delivered' && job.delivered_at
      ? (() => {
          const d = Math.round((new Date(localDateOf(job.delivered_at)).getTime() - new Date(localDateOf(job.started_at)).getTime()) / 86400000);
          return d > 0 ? d + 1 : null;
        })()
      : null;
  const unpaid = job.payment_status === 'unpaid';

  const action = (() => {
    if (!canWrite || !onAction) return null;
    const button = (label: string, icon: React.ReactNode, a: JobQuickAction, primary: boolean) => (
      <Pressable
        onPress={() => onAction(job, a)}
        disabled={pending}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${job.plate}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: 32,
          paddingHorizontal: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: primary ? t.colors.primary : t.colors.borderStrong,
          backgroundColor: primary ? t.colors.primary : t.colors.surface,
          opacity: pressed || pending ? 0.7 : 1,
        })}
      >
        {pending ? <ActivityIndicator size="small" color={primary ? t.colors.onPrimary : t.colors.text} /> : icon}
        <Txt style={{ fontSize: 12, fontWeight: '700', color: primary ? t.colors.onPrimary : t.colors.text }}>{label}</Txt>
      </Pressable>
    );
    if (job.status === 'in_progress') return button(tr('jobs.board.mark_ready'), <CheckCircle2 size={14} color={t.colors.text} />, 'ready', false);
    if (job.status === 'ready') return button(tr('jobs.board.deliver'), <KeyRound size={14} color={t.colors.onPrimary} />, 'deliver', true);
    if (job.status === 'delivered' && unpaid) return button(tr('jobs.actions.close'), <Wallet size={14} color={t.colors.warning} />, 'pay', false);
    return null;
  })();

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${job.plate} · ${job.customer_name}`}
      style={{ gap: 8, overflow: 'hidden', paddingTop: job.services?.length ? 18 : 16, borderColor: stale ? t.colors.warning : t.colors.border }}
    >
      <ServiceStripe services={job.services} />
      <Row gap={8} style={{ justifyContent: 'space-between' }}>
        <Row gap={8} style={{ flex: 1, minWidth: 0 }}>
          <PlateBadge plate={job.plate} size="sm" />
          {workDay ? <Badge size="sm" tone="info" label={tr('jobs.board.carry_over_day', { n: workDay })} /> : null}
          {!workDay && spanDays ? <Badge size="sm" tone="success" label={tr('jobs.board.delivered_span', { n: spanDays })} /> : null}
        </Row>
        <Txt variant="mono">{fmt.money(job.total_amount, job.currency)}</Txt>
      </Row>
      <View style={{ gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {job.customer_name}
        </Txt>
        {job.vehicle_label ? (
          <Row gap={4}>
            <Car size={12} color={t.colors.textMuted} />
            <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
              {job.vehicle_label}
            </Txt>
          </Row>
        ) : null}
      </View>
      <ServiceTags services={job.services} />
      <Row gap={8} style={{ justifyContent: 'space-between', marginTop: 2 }}>
        <Row gap={6} style={{ flex: 1 }}>
          {job.assignee_name ? <Avatar name={job.assignee_name} size={22} /> : null}
          {job.status === 'delivered' ? (
            <Txt variant="caption" tone="muted">
              {fmt.time(job.delivered_at ?? job.completed_at ?? job.started_at)}
            </Txt>
          ) : (
            <JobElapsed startedAt={job.started_at} now={now} stale={stale} />
          )}
          {job.status !== 'delivered' && job.status !== 'in_progress' && job.status !== 'ready' ? <JobStatusBadge status={job.status} size="sm" /> : null}
        </Row>
        {action ?? (job.status === 'delivered' ? <PaymentBadge status={job.payment_status} size="sm" /> : null)}
      </Row>
    </Card>
  );
}
