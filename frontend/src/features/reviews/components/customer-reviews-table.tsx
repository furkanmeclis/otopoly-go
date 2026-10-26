"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { EntityTable } from "@/components/entity";
import { routes } from "@/config/routes";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { FollowUpDialog } from "@/features/reviews/components/follow-up-dialog";
import { useReviewColumns } from "@/features/reviews/components/review-columns";
import {
  useReviews,
  useReviewsAccess,
} from "@/features/reviews/hooks/use-reviews";
import type { Review } from "@/features/reviews/types";
import { useLocale } from "@/providers/locale-provider";

/** Customer 360: the customer's review requests and answers. */
export function CustomerReviewsTable({
  slug,
  customerUuid,
}: {
  slug: string;
  customerUuid: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { canWrite } = useReviewsAccess(slug);
  const query = useReviews({ customer_uuid: customerUuid, limit: 100 });
  const [followUp, setFollowUp] = useState<Review | null>(null);
  const onFollowUp = useCallback((r: Review) => setFollowUp(r), []);
  const columns = useReviewColumns({
    slug,
    canWrite,
    onFollowUp,
    showCustomer: false,
    filters: false,
  });
  return (
    <>
      <EntityTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.tenant.reviews.detail(slug, row.uuid))
        }
        isLoading={query.isLoading}
        isError={query.isError}
        errorDescription={
          isFeatureDisabledError(query.error)
            ? t("billing.locked.body")
            : t("reviews.error")
        }
        onRetry={() => void query.refetch()}
        emptyTitle={t("reviews.customer.empty")}
        emptyDescription={t("reviews.customer.empty_hint")}
        features={{
          rowSelection: false,
          columnOrdering: false,
          columnPinning: false,
          columnResizing: false,
          viewMode: false,
        }}
      />
      <FollowUpDialog
        review={followUp}
        open={Boolean(followUp)}
        onOpenChange={(open) => {
          if (!open) setFollowUp(null);
        }}
      />
    </>
  );
}
