import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Card, Dot, RankBars, Row, Section, Txt } from '@/components/ui';
import { toNumber } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** Card with title/description and an empty fallback (web `AppChart` / table card shell). */
export function ReportCard({ title, description, icon, empty, children }: { title: string; description?: string; icon?: ReactNode; empty: boolean; children: ReactNode }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  return (
    <Card style={{ gap: t.spacing.md }}>
      <View style={{ gap: 2 }}>
        <Row gap={t.spacing.sm}>
          {icon}
          <Txt variant="bodyStrong" style={{ flex: 1 }}>
            {title}
          </Txt>
        </Row>
        {description ? (
          <Txt variant="caption" tone="secondary">
            {description}
          </Txt>
        ) : null}
      </View>
      {empty ? (
        <Txt variant="caption" tone="muted">
          {tr('reports.empty')}
        </Txt>
      ) : (
        children
      )}
    </Card>
  );
}

/** Proportion bars for a named-total series (web horizontal bar / pie / donut charts). */
export function RankChart({ items, money, color }: { items: { label: string; value: string }[]; money: (v?: string) => string; color?: string }) {
  const total = items.reduce((s, i) => s + toNumber(i.value), 0);
  const { fmt } = useLocale();
  return (
    <RankBars
      color={color}
      items={items.map((i) => ({ label: i.label, value: toNumber(i.value), display: money(i.value), sub: total > 0 ? fmt.percent(toNumber(i.value) / total) : undefined }))}
    />
  );
}

/** Web `NamedTable`: name, (qty), count, total. */
export function NamedTable({ title, icon, rows, money, showQty }: { title: string; icon?: ReactNode; rows: { name: string; total: string; count: number; qty?: string }[]; money: (v?: string) => string; showQty?: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  return (
    <Section>
      <ReportCard title={title} icon={icon} empty={!rows.length}>
        <View>
          <Row style={{ paddingBottom: t.spacing.sm, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <Txt variant="label" tone="secondary" style={{ flex: 1 }}>
              {tr('reports.tables.name')}
            </Txt>
            {showQty ? (
              <Txt variant="label" tone="secondary" style={{ width: 52, textAlign: 'right' }}>
                {tr('reports.tables.qty')}
              </Txt>
            ) : null}
            <Txt variant="label" tone="secondary" style={{ width: 48, textAlign: 'right' }}>
              {tr('reports.tables.count')}
            </Txt>
            <Txt variant="label" tone="secondary" style={{ width: 104, textAlign: 'right' }}>
              {tr('reports.tables.total')}
            </Txt>
          </Row>
          {rows.map((r, i) => (
            <Row key={`${r.name}-${i}`} style={{ paddingVertical: t.spacing.sm, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
              <Txt style={{ flex: 1 }} numberOfLines={2}>
                {r.name}
              </Txt>
              {showQty ? (
                <Txt variant="caption" style={{ width: 52, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {r.qty ? fmt.number(r.qty, 3) : '—'}
                </Txt>
              ) : null}
              <Txt variant="caption" style={{ width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                {r.count}
              </Txt>
              <Txt variant="caption" style={{ width: 104, textAlign: 'right', fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
                {money(r.total)}
              </Txt>
            </Row>
          ))}
        </View>
      </ReportCard>
    </Section>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  const t = useTheme();
  return (
    <Row gap={t.spacing.md} wrap>
      {items.map((i) => (
        <Row key={i.label} gap={6}>
          <Dot color={i.color} />
          <Txt variant="caption" tone="secondary">
            {i.label}
          </Txt>
        </Row>
      ))}
    </Row>
  );
}
