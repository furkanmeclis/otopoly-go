"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCheck, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityDetail,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { FeatureLocked } from "@/features/billing";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import {
  TenantLiveResources,
  useTenantLiveRefetch,
} from "@/features/organizations/hooks/use-tenant-live";
import { FollowUpDialog } from "@/features/reviews/components/follow-up-dialog";
import { StarRating } from "@/features/reviews/components/star-rating";
import {
  useReview,
  useReviewsAccess,
} from "@/features/reviews/hooks/use-reviews";
import {
  followUpTone,
  reviewStatusTone,
} from "@/features/reviews/lib/review-ui";
import { isApiError } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function ReviewDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { canRead, canWrite } = useReviewsAccess(slug);
  const query = useReview(uuid);
  useTenantLiveRefetch(TenantLiveResources.reviews, () => query.refetch(), {
    uuid,
    enabled: canRead,
  });
  const [followOpen, setFollowOpen] = useState(false);
  const when = (v?: string | null) =>
    v ? datetime(v, "dd.MM.yyyy HH:mm", locale) : "—";

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("reviews.forbidden")}
      />
    );
  }
  const breadcrumbs = [
    { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
    { label: t("reviews.title"), href: routes.tenant.reviews.root(slug) },
    { label: query.data?.customer_name || t("reviews.detail.title") },
  ];
  if (query.isLoading) {
    return (
      <EntityPage title={t("reviews.detail.title")} breadcrumbs={breadcrumbs}>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </EntityPage>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EntityPage title={t("reviews.detail.title")} breadcrumbs={breadcrumbs}>
        {isFeatureDisabledError(query.error) ? (
          <FeatureLocked slug={slug} />
        ) : (
          <ErrorState
            title={
              isApiError(query.error) && query.error.status === 404
                ? t("reviews.not_found")
                : t("reviews.error")
            }
            onRetry={() => void query.refetch()}
          />
        )}
      </EntityPage>
    );
  }
  const r = query.data;

  return (
    <EntityPage
      title={r.customer_name || t("reviews.detail.title")}
      description={
        r.kind === "test" ? t("reviews.detail.test_badge") : undefined
      }
      breadcrumbs={breadcrumbs}
      actions={
        r.follow_up_status === "required" && canWrite ? (
          <Button size="sm" onClick={() => setFollowOpen(true)}>
            <CheckCheck className="size-4" />
            {t("reviews.follow_up.action")}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <EntitySectionCard
          title={t("reviews.detail.answer")}
          className="lg:col-span-2"
        >
          {r.status === "answered" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <StarRating score={r.score} size="md" />
                <span className="text-2xl font-semibold tabular-nums">
                  {r.score}/5
                </span>
                {r.rating ? (
                  <StatusChip
                    label={t(`reviews.rating.${r.rating}`)}
                    tone={r.rating === "high" ? "success" : "danger"}
                  />
                ) : null}
              </div>
              <p className="text-sm whitespace-pre-wrap">
                {r.comment || (
                  <span className="text-muted-foreground">
                    {t("reviews.detail.no_comment")}
                  </span>
                )}
              </p>
              <EntityDetail
                sections={[
                  {
                    id: "answer",
                    fields: [
                      {
                        key: "answered_at",
                        label: t("reviews.fields.answered_at"),
                        value: when(r.answered_at),
                      },
                      {
                        key: "consent",
                        label: t("reviews.fields.consent"),
                        value: r.consent ? t("common.yes") : t("common.no"),
                      },
                      {
                        key: "google",
                        label: t("reviews.fields.google_redirects"),
                        value: r.google_redirects
                          ? `${r.google_redirects} · ${when(r.google_redirected_at)}`
                          : "0",
                      },
                    ],
                  },
                ]}
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t(`reviews.detail.waiting.${r.status}`)}
            </p>
          )}
        </EntitySectionCard>

        <EntitySectionCard title={t("reviews.detail.follow_up")}>
          <div className="space-y-3 text-sm">
            <StatusChip
              label={t(`reviews.follow_up_status.${r.follow_up_status}`)}
              tone={followUpTone(r.follow_up_status)}
            />
            {r.follow_up_status === "required" ? (
              <p className="text-muted-foreground">
                {t("reviews.detail.follow_up_hint")}
              </p>
            ) : null}
            {r.follow_up_status === "done" ? (
              <EntityDetail
                sections={[
                  {
                    id: "follow",
                    fields: [
                      {
                        key: "by",
                        label: t("reviews.fields.followed_up_by"),
                        value: r.followed_up_by_name || "—",
                      },
                      {
                        key: "at",
                        label: t("reviews.fields.followed_up_at"),
                        value: when(r.followed_up_at),
                      },
                      {
                        key: "note",
                        label: t("reviews.fields.follow_up_note"),
                        value: r.follow_up_note || "—",
                      },
                    ],
                  },
                ]}
              />
            ) : null}
          </div>
        </EntitySectionCard>

        <EntitySectionCard
          title={t("reviews.detail.delivery")}
          className="lg:col-span-3"
        >
          <EntityDetail
            sections={[
              {
                id: "delivery",
                fields: [
                  {
                    key: "status",
                    label: t("reviews.fields.status"),
                    value: (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <StatusChip
                          label={t(`reviews.status.${r.status}`)}
                          tone={reviewStatusTone(r.status)}
                        />
                        {r.skip_reason ? (
                          <span className="text-muted-foreground text-xs">
                            {t(`reviews.reason.${r.skip_reason}`)}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: "customer",
                    label: t("reviews.fields.customer"),
                    value: r.customer_uuid ? (
                      <Link
                        className="text-primary hover:underline"
                        href={routes.tenant.customers.detail(
                          slug,
                          r.customer_uuid,
                        )}
                      >
                        {r.customer_name}
                      </Link>
                    ) : (
                      r.customer_name || "—"
                    ),
                  },
                  {
                    key: "job",
                    label: t("reviews.fields.job"),
                    value: r.job_uuid ? (
                      <Link
                        href={routes.tenant.operations.detail(slug, r.job_uuid)}
                      >
                        <PlateBadge plate={r.plate || "—"} size="sm" />
                      </Link>
                    ) : r.plate ? (
                      <PlateBadge plate={r.plate} size="sm" />
                    ) : (
                      "—"
                    ),
                  },
                  {
                    key: "phone",
                    label: t("reviews.fields.phone"),
                    value: r.customer_phone || "—",
                  },
                  {
                    key: "channel",
                    label: t("reviews.fields.channel"),
                    value: r.channel ? t(`reviews.channel.${r.channel}`) : "—",
                  },
                  {
                    key: "send_at",
                    label: t("reviews.fields.send_at"),
                    value: (
                      <span>
                        {when(r.send_at)}
                        {r.deferred ? (
                          <span className="text-muted-foreground block text-xs">
                            {t("reviews.detail.deferred")}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: "sent_at",
                    label: t("reviews.fields.sent_at"),
                    value: when(r.sent_at),
                  },
                  {
                    key: "opened_at",
                    label: t("reviews.fields.opened_at"),
                    value: r.opened_at
                      ? `${when(r.opened_at)} · ${t("reviews.detail.views", { count: r.view_count })}`
                      : "—",
                  },
                  {
                    key: "expires_at",
                    label: t("reviews.fields.expires_at"),
                    value: when(r.expires_at),
                  },
                  ...(r.error
                    ? [
                        {
                          key: "error",
                          label: t("reviews.fields.error"),
                          value: (
                            <span className="text-destructive text-xs">
                              {r.error}
                            </span>
                          ),
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
          {r.public_url ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(r.public_url ?? "")
                    .then(() => toast.success(t("reviews.detail.copied")));
                }}
              >
                <Copy className="size-4" />
                {t("reviews.detail.copy_link")}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={r.public_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  {t("reviews.detail.open_link")}
                </a>
              </Button>
            </div>
          ) : null}
        </EntitySectionCard>
      </div>
      <FollowUpDialog
        review={followOpen ? r : null}
        open={followOpen}
        onOpenChange={setFollowOpen}
      />
    </EntityPage>
  );
}
