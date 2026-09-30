import { useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, FileDown, Globe, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { downloadAndShare } from '@/api/files';
import { useToast, useApiErrorMessage } from '@/components/feedback/toast';
import { Amount, Badge, Button, Card, EmptyState, ErrorState, Group, InfoRow, ListSkeleton, Row, Screen, Header, Section, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { INVOICE_TONE, meterLabel, meterTone, meterUnlimited, ORDER_TONE, planFeatureLine, STATUS_TONE } from '@/features/billing/lib';
import { useBillingInvoices, useBillingOrders, useBillingOverview, useInvoiceProfile } from '@/features/billing/queries';
import type { BillingInvoice, BillingOrder, BillingOverview, BillingPlan, BillingUsageMeter } from '@/features/billing/types';
import { qk } from '@/features/queries';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.billing');

/**
 * Web `settings/billing` (SubscriptionPage), read-only on mobile: App Store guideline 3.1.1 forbids
 * selling digital subscriptions outside in-app purchase, so plan purchase, payment reporting,
 * order cancellation and invoice-profile edits stay on the web. No purchase links are shown.
 */
export default function BillingScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.billingRead} title={tr('billing.title')}>
      <Billing />
    </RequirePermission>
  );
}

function Billing() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const overview = useBillingOverview(true);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: qk.billing });
    setRefreshing(false);
  };
  const data = overview.data;

  return (
    <Screen header={<Header title={tr('billing.title')} subtitle={tr('billing.description')} />} refreshing={refreshing} onRefresh={() => void refresh()}>
      <Card style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start', backgroundColor: t.colors.infoBg }}>
        <Globe size={18} color={t.colors.info} style={{ marginTop: 2 }} />
        <Txt variant="caption" tone="info" style={{ flex: 1 }}>
          {tr('mobile.settings.billing_web_note')}
        </Txt>
      </Card>

      {overview.isLoading ? (
        <ListSkeleton rows={4} height={96} />
      ) : overview.isError ? (
        <ErrorState onRetry={() => void overview.refetch()} />
      ) : !data ? (
        <EmptyState title={tr('billing.no_subscription')} />
      ) : (
        <>
          {data.open_order ? <OpenOrderCard order={data.open_order} /> : null}
          <PlanCard overview={data} />
          <UsageSection meters={data.meters} />
          <FeaturesSection meters={data.meters} plan={data.plan ?? null} />
          <OrdersSection />
          <InvoiceProfileSection />
          <InvoicesSection />
        </>
      )}
    </Screen>
  );
}

function PlanCard({ overview }: { overview: BillingOverview }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const sub = overview.subscription;
  if (!sub) return <EmptyState title={tr('billing.no_subscription')} />;
  const expired = sub.days_left <= 0;
  return (
    <Section title={tr('billing.current_plan')}>
      <Card style={{ gap: t.spacing.md }}>
        <Row gap={t.spacing.sm} wrap>
          <CreditCard size={20} color={t.colors.textSecondary} />
          <Txt variant="title">{sub.plan_name}</Txt>
          <Badge tone={STATUS_TONE[sub.status]} label={tr(`billing.status.${sub.status}`)} />
        </Row>
        {overview.plan?.description ? (
          <Txt variant="caption" tone="secondary">
            {overview.plan.description}
          </Txt>
        ) : null}
        <Group>
          <InfoRow label={tr(`billing.period.${sub.period}`)} value={`${tr('billing.starts_at')}: ${fmt.date(sub.starts_at, 'short')}`} />
          <InfoRow label={tr('billing.ends_at')} last={!(toNumber(sub.credit_balance) > 0)}>
            <Txt tone={expired ? 'danger' : 'default'}>
              {fmt.date(sub.ends_at, 'short')} · {expired ? tr('billing.expired') : tr('billing.days_left', { days: sub.days_left })}
            </Txt>
          </InfoRow>

          {toNumber(sub.credit_balance) > 0 ? (
            <InfoRow label={tr('mobile.settings.billing_credit')} last>
              <Txt tone="success">{tr('billing.credit_balance', { amount: fmt.money(sub.credit_balance) })}</Txt>
            </InfoRow>
          ) : null}
        </Group>
      </Card>
    </Section>
  );
}

function UsageMeterRow({ meter }: { meter: BillingUsageMeter }) {
  const t = useTheme();
  const { t: tr, locale, fmt } = useLocale();
  const unlimited = meterUnlimited(meter);
  const tone = meterTone(meter);
  const limit = unlimited ? 0 : (meter.limit as number);
  const pct = unlimited ? 0 : Math.min(100, Math.round((meter.used / Math.max(1, limit)) * 100));
  const tolerance = Math.round(limit * (1 + meter.tolerance_pct / 100));
  const color = tone === 'over' ? t.colors.danger : tone === 'warn' ? t.colors.warning : t.colors.primary;
  const value = unlimited ? tr('billing.usage.unlimited') : tr('billing.usage.of', { used: fmt.number(meter.used), limit: fmt.number(limit) });
  const periodSuffix = meter.period === 'day' || meter.period === 'month' ? ` · ${tr(`billing.usage.period.${meter.period}`)}` : '';
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`${meterLabel(meter, locale)}: ${value}`}>
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
        <Txt variant="bodyStrong" style={{ flexShrink: 1 }} numberOfLines={1}>
          {meterLabel(meter, locale)}
        </Txt>
        <Txt variant="caption" tone={tone === 'over' ? 'danger' : tone === 'warn' ? 'warning' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
          {value}
          {periodSuffix}
        </Txt>
      </Row>
      {!unlimited ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
        </View>
      ) : null}
      {!unlimited && (meter.tolerance_pct > 0 || meter.enforcement === 'soft') ? (
        <Txt variant="caption" tone="muted" style={{ fontSize: 11 }}>
          {[meter.tolerance_pct > 0 ? tr('billing.usage.tolerance', { tolerance: fmt.number(tolerance) }) : null, meter.enforcement === 'soft' ? tr('billing.usage.soft') : null].filter(Boolean).join(' · ')}
        </Txt>
      ) : null}
    </View>
  );
}

function UsageSection({ meters }: { meters: BillingUsageMeter[] }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const limits = meters.filter((m) => m.kind === 'limit');
  return (
    <Section title={tr('billing.usage.title')}>
      <Card style={{ gap: t.spacing.lg }}>
        {limits.length === 0 ? (
          <Txt variant="caption" tone="secondary">
            {tr('billing.usage.empty')}
          </Txt>
        ) : (
          limits.map((m) => <UsageMeterRow key={m.key} meter={m} />)
        )}
      </Card>
    </Section>
  );
}

function FeaturesSection({ meters, plan }: { meters: BillingUsageMeter[]; plan: BillingPlan | null }) {
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const toggles = meters.filter((m) => m.kind === 'toggle');
  const displays = plan?.features.filter((f) => f.display_text) ?? [];
  const limits = plan?.features.filter((f) => !f.display_text && f.kind === 'limit') ?? [];
  if (!toggles.length && !displays.length && !limits.length) return null;
  return (
    <Section title={tr('billing.features.title')}>
      <Card style={{ gap: t.spacing.md }}>
        {toggles.map((m) => {
          const on = m.enabled !== false;
          return (
            <Row key={m.key} gap={t.spacing.md} style={{ justifyContent: 'space-between' }}>
              <Txt style={{ flex: 1 }}>{meterLabel(m, locale)}</Txt>
              <Badge
                size="sm"
                tone={on ? 'success' : 'neutral'}
                icon={on ? <Check size={11} color={t.colors.success} /> : <X size={11} color={t.colors.neutral} />}
                label={on ? tr('billing.features.on') : tr('billing.features.off')}
              />
            </Row>
          );
        })}
        {limits.map((f) => (
          <Txt key={f.key} variant="caption" tone="secondary">
            {planFeatureLine(f, locale, tr)}
          </Txt>
        ))}
        {displays.map((f) => (
          <Row key={f.key} gap={t.spacing.md} style={{ justifyContent: 'space-between' }}>
            <Txt style={{ flex: 1 }}>{f.display_text}</Txt>
            <Check size={16} color={t.colors.success} />
          </Row>
        ))}
      </Card>
    </Section>
  );
}

function OpenOrderCard({ order }: { order: BillingOrder }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Section title={tr('billing.order.title')}>
      <Card style={{ gap: t.spacing.sm, borderWidth: 1, borderColor: t.colors.primary }}>
        <Row gap={t.spacing.sm} wrap style={{ justifyContent: 'space-between' }}>
          <Txt variant="mono">{order.reference_code}</Txt>
          <Badge tone={ORDER_TONE[order.status]} label={tr(`billing.order.status.${order.status}`)} />
        </Row>
        <Txt>
          {order.plan.name} · {tr(`billing.period.${order.period}`)}
        </Txt>
        {order.lines.map((l, i) => (
          <Row key={i} gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
            <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
              {l.label}
            </Txt>
            <Amount value={l.amount} variant="caption" />
          </Row>
        ))}
        <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
          <Txt variant="bodyStrong">{tr('billing.order.amount')}</Txt>
          <Amount value={order.total} />
        </Row>
        {order.status === 'payment_reported' ? (
          <Txt variant="caption" tone="info">
            {tr('billing.order.reported_note')}
          </Txt>
        ) : null}
      </Card>
    </Section>
  );
}

function OrdersSection() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const orders = useBillingOrders(true);
  const items = orders.data?.items ?? [];
  return (
    <Section title={tr('billing.order.history')}>
      {orders.isLoading ? (
        <ListSkeleton rows={2} height={64} />
      ) : orders.isError ? (
        <ErrorState onRetry={() => void orders.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <Txt variant="caption" tone="secondary">
            {tr('billing.order.history_empty')}
          </Txt>
        </Card>
      ) : (
        <Card padded={false}>
          {items.map((o, i) => (
            <View key={o.uuid} style={{ padding: t.spacing.md, gap: 4, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.border }}>
              <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
                <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {o.plan.name} · {tr(`billing.period.${o.period}`)}
                </Txt>
                <Amount value={o.total} />
              </Row>
              <Row gap={t.spacing.sm} wrap style={{ justifyContent: 'space-between' }}>
                <Txt variant="caption" tone="secondary">
                  {fmt.date(o.created_at, 'short')} · {o.reference_code}
                </Txt>
                <Badge size="sm" tone={ORDER_TONE[o.status]} label={tr(`billing.order.status.${o.status}`)} />
              </Row>
              {o.reject_reason ? (
                <Txt variant="caption" tone="danger">
                  {tr('billing.order.reject_reason', { reason: o.reject_reason })}
                </Txt>
              ) : null}
            </View>
          ))}
        </Card>
      )}
    </Section>
  );
}

function InvoiceProfileSection() {
  const { t: tr } = useLocale();
  const profile = useInvoiceProfile(true);
  const p = profile.data;
  return (
    <Section title={tr('billing.profile.title')}>
      {profile.isLoading ? (
        <ListSkeleton rows={1} height={120} />
      ) : profile.isError ? (
        <ErrorState onRetry={() => void profile.refetch()} />
      ) : p ? (
        <Group>
          <InfoRow label={tr('billing.profile.name')} value={p.invoice_name || '—'} />
          <InfoRow label={tr('billing.profile.tax_id')} value={p.invoice_tax_id || '—'} />
          <InfoRow label={tr('billing.profile.tax_office')} value={p.invoice_tax_office || '—'} />
          <InfoRow label={tr('billing.profile.address')} value={p.invoice_address || '—'} />
          <InfoRow label={tr('billing.profile.city')} value={p.invoice_city || '—'} />
          <InfoRow label={tr('billing.profile.email')} value={p.invoice_email || '—'} last />
        </Group>
      ) : null}
      {p && !p.invoice_tax_id ? (
        <Txt variant="caption" tone="muted">
          {tr('billing.profile.final_consumer')}
        </Txt>
      ) : null}
    </Section>
  );
}

function InvoicesSection() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const invoices = useBillingInvoices(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const items = invoices.data?.items ?? [];

  const openPdf = async (inv: BillingInvoice) => {
    setDownloading(inv.uuid);
    try {
      await downloadAndShare(`/v1/tenant/billing/invoices/${inv.uuid}/pdf`, `${inv.number}.pdf`);
    } catch (error) {
      log.error('Invoice PDF failed', { uuid: inv.uuid, error });
      toast.error(tr('common.error_generic'), toMessage(error));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Section title={tr('billing.invoices.title')}>
      {invoices.isLoading ? (
        <ListSkeleton rows={2} height={64} />
      ) : invoices.isError ? (
        <ErrorState onRetry={() => void invoices.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <Txt variant="caption" tone="secondary">
            {tr('billing.invoices.empty')}
          </Txt>
        </Card>
      ) : (
        <Card padded={false}>
          {items.map((inv, i) => (
            <View key={inv.uuid} style={{ padding: t.spacing.md, gap: t.spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.border }}>
              <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="caption" style={{ fontFamily: 'Menlo' }} numberOfLines={1}>
                    {inv.number}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {fmt.date(inv.issue_date, 'short')}
                  </Txt>
                </View>
                <Amount value={inv.grand_total} />
              </Row>
              <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
                <Badge size="sm" tone={INVOICE_TONE[inv.status]} label={tr(`billing.invoices.status.${inv.status}`)} />
                {inv.has_pdf ? (
                  <Button size="sm" variant="outline" label={tr('billing.invoices.pdf')} icon={<FileDown size={16} color={t.colors.text} />} loading={downloading === inv.uuid} onPress={() => void openPdf(inv)} />
                ) : (
                  <Txt variant="caption" tone="muted">
                    {tr('billing.invoices.no_pdf')}
                  </Txt>
                )}
              </Row>
            </View>
          ))}
        </Card>
      )}
    </Section>
  );
}
