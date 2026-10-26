"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCheck, MessageCircle, Smartphone } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { StarRating } from "@/features/reviews/components/star-rating";
import {
  followUpTone,
  reviewStatusTone,
} from "@/features/reviews/lib/review-ui";
import {
  REVIEW_FOLLOW_UPS,
  REVIEW_STATUSES,
  type Review,
} from "@/features/reviews/types";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** DataTable columns of review requests (list page and customer 360). */
export function useReviewColumns({
  slug,
  canWrite,
  onFollowUp,
  showCustomer = true,
  filters = true,
}: {
  slug: string;
  canWrite: boolean;
  onFollowUp: (review: Review) => void;
  showCustomer?: boolean;
  filters?: boolean;
}) {
  const { t, locale } = useLocale();
  return useMemo<ColumnDef<Review>[]>(() => {
    const cols: ColumnDef<Review>[] = [
      createColumn<Review>({
        accessorKey: "created_at",
        labelKey: "reviews.fields.date",
        enableSorting: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.reviews.detail(slug, row.original.uuid)}
            className="tabular-nums hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {datetime(
              row.original.answered_at ?? row.original.created_at,
              "dd.MM.yyyy HH:mm",
              locale,
            )}
          </Link>
        ),
      }),
    ];
    if (showCustomer) {
      cols.push(
        createColumn<Review>({
          accessorKey: "customer_name",
          labelKey: "reviews.fields.customer",
          gridPrimary: true,
          cell: ({ row }) =>
            row.original.customer_uuid ? (
              <Link
                href={routes.tenant.customers.detail(
                  slug,
                  row.original.customer_uuid,
                )}
                className="font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {row.original.customer_name}
              </Link>
            ) : (
              <span className="font-medium">
                {row.original.customer_name || "—"}
              </span>
            ),
        }),
      );
    }
    cols.push(
      createColumn<Review>({
        accessorKey: "plate",
        labelKey: "reviews.fields.job",
        cell: ({ row }) =>
          row.original.plate ? (
            row.original.job_uuid ? (
              <Link
                href={routes.tenant.operations.detail(
                  slug,
                  row.original.job_uuid,
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <PlateBadge plate={row.original.plate} size="sm" />
              </Link>
            ) : (
              <PlateBadge plate={row.original.plate} size="sm" />
            )
          ) : (
            "—"
          ),
      }),
      createColumn<Review>({
        accessorKey: "score",
        labelKey: "reviews.fields.score",
        enableSorting: true,
        filterVariant: filters ? "select" : undefined,
        filterOptions: filters
          ? [5, 4, 3, 2, 1].map((s) => ({
              value: String(s),
              label: `${s} ★`,
            }))
          : undefined,
        cell: ({ row }) => <StarRating score={row.original.score} />,
      }),
      createColumn<Review>({
        accessorKey: "comment",
        labelKey: "reviews.fields.comment",
        cell: ({ row }) =>
          row.original.comment ? (
            <span
              className="line-clamp-2 max-w-72 text-sm whitespace-pre-wrap"
              title={row.original.comment}
            >
              {row.original.comment}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      createColumn<Review>({
        accessorKey: "channel",
        labelKey: "reviews.fields.channel",
        filterVariant: filters ? "faceted" : undefined,
        filterOptions: filters
          ? (["whatsapp", "sms"] as const).map((value) => ({
              value,
              label: value,
              labelKey: `reviews.channel.${value}`,
            }))
          : undefined,
        cell: ({ row }) =>
          row.original.channel ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              {row.original.channel === "sms" ? (
                <Smartphone className="size-3.5" />
              ) : (
                <MessageCircle className="size-3.5" />
              )}
              {t(`reviews.channel.${row.original.channel}`)}
            </span>
          ) : (
            "—"
          ),
      }),
      createColumn<Review>({
        accessorKey: "status",
        labelKey: "reviews.fields.status",
        filterVariant: filters ? "faceted" : undefined,
        filterOptions: filters
          ? REVIEW_STATUSES.map((value) => ({
              value,
              label: value,
              labelKey: `reviews.status.${value}`,
            }))
          : undefined,
        cell: ({ row }) => (
          <span
            title={
              row.original.skip_reason
                ? t(`reviews.reason.${row.original.skip_reason}`)
                : undefined
            }
          >
            <StatusChip
              label={t(`reviews.status.${row.original.status}`)}
              tone={reviewStatusTone(row.original.status)}
            />
          </span>
        ),
      }),
      createColumn<Review>({
        accessorKey: "follow_up_status",
        labelKey: "reviews.fields.follow_up",
        filterVariant: filters ? "faceted" : undefined,
        filterOptions: filters
          ? REVIEW_FOLLOW_UPS.map((value) => ({
              value,
              label: value,
              labelKey: `reviews.follow_up_status.${value}`,
            }))
          : undefined,
        cell: ({ row }) => {
          const r = row.original;
          if (r.follow_up_status === "required" && canWrite) {
            return (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onFollowUp(r);
                }}
              >
                <CheckCheck className="size-3.5" />
                {t("reviews.follow_up.action")}
              </Button>
            );
          }
          if (r.follow_up_status === "none") {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <span
              className="flex flex-col gap-0.5"
              title={r.follow_up_note || undefined}
            >
              <StatusChip
                label={t(`reviews.follow_up_status.${r.follow_up_status}`)}
                tone={followUpTone(r.follow_up_status)}
              />
              {r.follow_up_note ? (
                <span className="text-muted-foreground line-clamp-1 max-w-48 text-xs">
                  {r.follow_up_note}
                </span>
              ) : null}
            </span>
          );
        },
      }),
    );
    return cols;
  }, [canWrite, filters, locale, onFollowUp, showCustomer, slug, t]);
}
