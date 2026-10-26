import { router } from 'expo-router';
import { CheckCheck, MessageCircle, Smartphone } from 'lucide-react-native';

import { Badge, Button, Card, PlateBadge, Row, Txt } from '@/components/ui';
import { Stars } from '@/features/reviews/components/stars';
import { followUpTone, reviewStatusTone } from '@/features/reviews/lib/review-ui';
import type { Review } from '@/features/reviews/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** One review request row (list screen and customer 360). */
export function ReviewCard({ review, canWrite, onFollowUp, hideCustomer }: { review: Review; canWrite: boolean; onFollowUp?: (r: Review) => void; hideCustomer?: boolean }) {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const needsFollowUp = review.follow_up_status === 'required';
  const ChannelIcon = review.channel === 'sms' ? Smartphone : MessageCircle;
  return (
    <Card
      onPress={() => router.push(`/reviews/${review.uuid}`)}
      accessibilityLabel={`${review.customer_name} ${review.score ? `${review.score}/5` : tr(`reviews.status.${review.status}`)}`}
      style={{ gap: 6, paddingVertical: t.spacing.md, borderLeftWidth: 4, borderLeftColor: needsFollowUp ? t.colors.danger : review.rating === 'high' ? t.colors.success : t.colors.border }}
    >
      <Row gap={t.spacing.sm} style={{ justifyContent: 'space-between' }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {hideCustomer ? fmt.date(review.answered_at ?? review.created_at) : review.customer_name || '—'}
        </Txt>
        {review.score ? <Stars score={review.score} /> : <Badge size="sm" tone={reviewStatusTone(review.status)} label={tr(`reviews.status.${review.status}`)} />}
      </Row>
      {review.comment ? (
        <Txt tone="secondary" numberOfLines={2}>
          “{review.comment}”
        </Txt>
      ) : null}
      <Row gap={t.spacing.sm} wrap style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flexShrink: 1 }}>
          {review.plate ? <PlateBadge plate={review.plate} size="sm" /> : null}
          {review.channel ? <ChannelIcon size={14} color={t.colors.textMuted} /> : null}
          {!hideCustomer ? (
            <Txt variant="caption" tone="muted">
              {fmt.date(review.answered_at ?? review.created_at)}
            </Txt>
          ) : null}
        </Row>
        {review.follow_up_status !== 'none' ? <Badge size="sm" tone={followUpTone(review.follow_up_status)} label={tr(`reviews.follow_up_status.${review.follow_up_status}`)} /> : null}
      </Row>
      {needsFollowUp && canWrite && onFollowUp ? (
        <Button size="sm" variant="outline" label={tr('reviews.follow_up.action')} icon={<CheckCheck size={16} color={t.colors.text} />} onPress={() => onFollowUp(review)} />
      ) : null}
    </Card>
  );
}
