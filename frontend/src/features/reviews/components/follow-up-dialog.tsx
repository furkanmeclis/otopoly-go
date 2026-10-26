"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "@/features/reviews/components/star-rating";
import { useReviewMutations } from "@/features/reviews/hooks/use-reviews";
import type { Review } from "@/features/reviews/types";
import { useLocale } from "@/providers/locale-provider";

/** "Ele alındı": marks an answered review handled with an optional note. */
export function FollowUpDialog({
  review,
  open,
  onOpenChange,
}: {
  review: Review | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { followUp } = useReviewMutations();
  const [note, setNote] = useState("");

  async function submit() {
    if (!review) return;
    await followUp.mutateAsync({ uuid: review.uuid, note: note.trim() });
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reviews.follow_up.title")}</DialogTitle>
          <DialogDescription>
            {t("reviews.follow_up.description")}
          </DialogDescription>
        </DialogHeader>
        {review ? (
          <div className="bg-muted/40 space-y-1 rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">
                {review.customer_name}
              </span>
              <StarRating score={review.score} />
            </div>
            {review.comment ? (
              <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                {review.comment}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="review-follow-up-note">
            {t("reviews.follow_up.note")}
          </Label>
          <Textarea
            id="review-follow-up-note"
            value={note}
            maxLength={1000}
            rows={3}
            placeholder={t("reviews.follow_up.note_placeholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={followUp.isPending}>
            {t("reviews.follow_up.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
