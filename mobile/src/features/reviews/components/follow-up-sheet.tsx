import { useState } from 'react';

import { Button, Sheet, TextField, Txt } from '@/components/ui';
import { Stars } from '@/features/reviews/components/stars';
import { useReviewMutations } from '@/features/reviews/queries';
import type { Review } from '@/features/reviews/types';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

/** "Ele alındı": web `FollowUpDialog`; optional note, owner only (backend requires the owner role). */
export function FollowUpSheet({ review, onClose }: { review: Review | null; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { followUp } = useReviewMutations();
  const [note, setNote] = useState('');
  const close = () => {
    setNote('');
    onClose();
  };
  return (
    <Sheet
      visible={Boolean(review)}
      onClose={close}
      title={tr('reviews.follow_up.title')}
      footer={
        <Button
          label={tr('reviews.follow_up.submit')}
          loading={followUp.isPending}
          onPress={() => {
            if (!review) return;
            followUp.mutate({ uuid: review.uuid, note: note.trim() }, { onSuccess: close });
          }}
        />
      }
    >
      <Txt tone="secondary">{tr('reviews.follow_up.description')}</Txt>
      {review ? (
        <>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {review.customer_name}
          </Txt>
          <Stars score={review.score} size={18} />
          {review.comment ? (
            <Txt tone="secondary" style={{ marginBottom: t.spacing.sm }}>
              “{review.comment}”
            </Txt>
          ) : null}
        </>
      ) : null}
      <TextField
        label={tr('reviews.follow_up.note')}
        value={note}
        onChangeText={setNote}
        placeholder={tr('reviews.follow_up.note_placeholder')}
        multiline
        maxLength={1000}
      />
    </Sheet>
  );
}
