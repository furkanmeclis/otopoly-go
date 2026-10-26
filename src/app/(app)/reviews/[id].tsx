/** Review detail — web `/t/[slug]/reviews/[uuid]` (`review-detail-page.tsx`): answer, follow-up, delivery timeline. */
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCheck, Star } from 'lucide-react-native';
import { useState } from 'react';
import { Share } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Button, DetailHero, ErrorState, Group, Header, InfoRow, LinkValue, ListSkeleton, PlateBadge, Row, Screen, Section, Txt, usePullRefresh } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { useLiveResource } from '@/features/live/use-live-resource';
import { FollowUpSheet } from '@/features/reviews/components/follow-up-sheet';
import { Stars } from '@/features/reviews/components/stars';
import { followUpTone, reviewStatusTone } from '@/features/reviews/lib/review-ui';
import { useReview, useReviewsAccess } from '@/features/reviews/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function ReviewDetailScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.reviewsRead} title={tr('reviews.detail.title')}>
      <ReviewDetail />
    </RequirePermission>
  );
}

function ReviewDetail() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  useLiveResource('tenant.reviews');
  const query = useReview(id);
  const access = useReviewsAccess();
  const pull = usePullRefresh(query);
  const [followOpen, setFollowOpen] = useState(false);
  const when = (v?: string | null) => (v ? fmt.dateTime(v) : '—');

  if (query.isLoading) {
    return (
      <Screen header={<Header title={tr('reviews.detail.title')} />}>
        <ListSkeleton rows={4} height={72} />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen header={<Header title={tr('reviews.detail.title')} />}>
        {isFeatureDisabled(query.error) ? <FeatureLockedState feature="reviews.enabled" /> : <ErrorState error={query.error} description={tr('reviews.not_found')} onRetry={() => void query.refetch()} />}
      </Screen>
    );
  }
  const r = query.data;
  const canFollowUp = r.follow_up_status === 'required' && access.canWrite;

  return (
    <Screen
      header={<Header title={r.customer_name || tr('reviews.detail.title')} subtitle={r.kind === 'test' ? tr('reviews.detail.test_badge') : undefined} />}
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      footer={canFollowUp ? <Button label={tr('reviews.follow_up.action')} icon={<CheckCheck size={18} color={t.colors.onPrimary} />} onPress={() => setFollowOpen(true)} /> : undefined}
    >
      <DetailHero
        leading={<Star size={28} color={t.colors.warning} fill={r.score ? t.colors.warning : 'transparent'} />}
        title={r.score ? `${r.score}/5` : tr(`reviews.status.${r.status}`)}
        subtitle={r.answered_at ? when(r.answered_at) : tr(`reviews.detail.waiting.${r.status}`)}
        badges={
          <Row gap={6} wrap>
            <Badge size="sm" tone={reviewStatusTone(r.status)} label={tr(`reviews.status.${r.status}`)} />
            {r.rating ? <Badge size="sm" tone={r.rating === 'high' ? 'success' : 'danger'} label={tr(`reviews.rating.${r.rating}`)} /> : null}
            {r.follow_up_status !== 'none' ? <Badge size="sm" tone={followUpTone(r.follow_up_status)} label={tr(`reviews.follow_up_status.${r.follow_up_status}`)} /> : null}
          </Row>
        }
      >
        {r.score ? <Stars score={r.score} size={22} /> : null}
        {r.status === 'answered' ? <Txt tone={r.comment ? 'default' : 'muted'}>{r.comment ? `“${r.comment}”` : tr('reviews.detail.no_comment')}</Txt> : null}
      </DetailHero>

      {r.follow_up_status !== 'none' ? (
        <Section title={tr('reviews.detail.follow_up')}>
          <Group>
            {r.follow_up_status === 'required' ? (
              <InfoRow label={tr('reviews.fields.follow_up')} last>
                <Txt tone="danger">{tr('reviews.detail.follow_up_hint')}</Txt>
              </InfoRow>
            ) : (
              <>
                <InfoRow label={tr('reviews.fields.followed_up_by')} value={r.followed_up_by_name || '—'} />
                <InfoRow label={tr('reviews.fields.followed_up_at')} value={when(r.followed_up_at)} />
                <InfoRow label={tr('reviews.fields.follow_up_note')} value={r.follow_up_note || '—'} last />
              </>
            )}
          </Group>
        </Section>
      ) : null}

      <Section title={tr('reviews.detail.delivery')}>
        <Group>
          {r.customer_uuid ? (
            <InfoRow label={tr('reviews.fields.customer')}>
              <LinkValue label={r.customer_name} onPress={() => router.push(`/customers/${r.customer_uuid}`)} />
            </InfoRow>
          ) : (
            <InfoRow label={tr('reviews.fields.customer')} value={r.customer_name || '—'} />
          )}
          {r.plate ? (
            <InfoRow label={tr('reviews.fields.job')}>
              {r.job_uuid ? <LinkValue label={r.plate} leading={<PlateBadge plate={r.plate} size="sm" />} onPress={() => router.push(`/jobs/${r.job_uuid}`)} /> : <PlateBadge plate={r.plate} size="sm" />}
            </InfoRow>
          ) : null}
          <InfoRow label={tr('reviews.fields.phone')} value={r.customer_phone || '—'} />
          <InfoRow label={tr('reviews.fields.channel')} value={r.channel ? tr(`reviews.channel.${r.channel}`) : '—'} />
          <InfoRow label={tr('reviews.fields.send_at')} value={`${when(r.send_at)}${r.deferred ? ` · ${tr('reviews.detail.deferred')}` : ''}`} />
          <InfoRow label={tr('reviews.fields.sent_at')} value={when(r.sent_at)} />
          <InfoRow label={tr('reviews.fields.opened_at')} value={r.opened_at ? `${when(r.opened_at)} · ${tr('reviews.detail.views', { count: r.view_count })}` : '—'} />
          <InfoRow label={tr('reviews.fields.expires_at')} value={when(r.expires_at)} />
          <InfoRow label={tr('reviews.fields.google_redirects')} value={String(r.google_redirects)} />
          {r.skip_reason ? <InfoRow label={tr('reviews.fields.status')} value={tr(`reviews.reason.${r.skip_reason}`)} /> : null}
          {r.error ? <InfoRow label={tr('reviews.fields.error')} value={r.error} /> : null}
          <InfoRow label={tr('reviews.fields.consent')} value={r.consent ? tr('common.yes') : tr('common.no')} last />
        </Group>
      </Section>

      {r.public_url ? (
        <Button
          variant="outline"
          label={tr('mobile.reviews.share_link')}
          onPress={() => {
            void Share.share({ message: r.public_url ?? '' });
          }}
        />
      ) : null}

      <FollowUpSheet review={followOpen ? r : null} onClose={() => setFollowOpen(false)} />
    </Screen>
  );
}
