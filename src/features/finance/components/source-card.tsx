import { router } from 'expo-router';
import { ExternalLink } from 'lucide-react-native';
import { View } from 'react-native';

import { Badge, Button, Card, PlateBadge, Row, Txt, type Tone } from '@/components/ui';
import { sourceRoute } from '@/features/finance/lib';
import type { FinanceSourceDetail } from '@/features/finance/services/finance.service';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

const lineTone: Record<FinanceSourceDetail['lines'][number]['type'], Tone> = { service: 'info', product: 'primary', custom: 'neutral' };

/** What the money was for: the job / sale / purchase lines, linked to the source document (web `FinanceSourceCard`). */
export function SourceCard({ detail, currency }: { detail: FinanceSourceDetail; currency: string }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const cur = detail.currency || currency;
  const meta = [detail.subtitle, detail.date ? fmt.dateTime(detail.date) : null].filter(Boolean).join(' · ');

  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.sm, backgroundColor: t.colors.surfaceAlt, borderBottomWidth: detail.lines.length ? 1 : 0, borderBottomColor: t.colors.border }}>
        <Txt variant="label" tone="secondary">
          {tr(`finance.detail.source_types.${detail.kind}`)}
        </Txt>
        <Row gap={t.spacing.sm} wrap>
          {detail.plate ? <PlateBadge plate={detail.plate} size="sm" /> : null}
          <Txt variant="bodyStrong" style={{ flexShrink: 1 }}>
            {detail.title || (detail.kind === 'product_sale' ? tr('finance.detail.walk_in_sale') : '—')}
          </Txt>
        </Row>
        {meta ? (
          <Txt variant="caption" tone="secondary">
            {meta}
          </Txt>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          style={{ alignSelf: 'flex-start' }}
          label={tr(`finance.detail.open_source.${detail.kind}`)}
          icon={<ExternalLink size={14} color={t.colors.text} />}
          onPress={() => router.push(sourceRoute(detail) as never)}
        />
      </View>
      {detail.lines.map((line, i) => (
        <View
          key={`${line.name}-${i}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, borderBottomWidth: 1, borderBottomColor: t.colors.border }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Row gap={6}>
              <Badge size="sm" tone={lineTone[line.type] ?? 'neutral'} label={tr(`finance.detail.lines.types.${line.type}`)} />
              <Txt variant="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>
                {line.name}
              </Txt>
            </Row>
            <Txt variant="caption" tone="secondary">
              {tr('finance.detail.lines.qty')}: {fmt.number(line.qty, 3)} · {tr('finance.detail.lines.unit_price')}: {fmt.money(line.unit_price, cur)}
            </Txt>
          </View>
          <Txt variant="mono">{fmt.money(line.line_total, cur)}</Txt>
        </View>
      ))}
      {detail.lines.length > 0 && detail.total ? (
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, backgroundColor: t.colors.surfaceAlt }}>
          <Txt variant="bodyStrong">{tr('finance.detail.lines.document_total')}</Txt>
          <Txt variant="mono">{fmt.money(detail.total, cur)}</Txt>
        </Row>
      ) : null}
    </Card>
  );
}
