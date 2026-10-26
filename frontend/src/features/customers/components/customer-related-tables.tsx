"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { BrandMark } from "@/components/common/brand-mark";
import { StatusChip } from "@/components/common/status-chip";
import { EntityTable } from "@/components/entity";
import { createColumn } from "@/components/tables";
import { routes } from "@/config/routes";
import type { CustomerSummary } from "@/features/customers/services/customers.service";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { useCustomerJobs } from "@/features/jobs/hooks/use-jobs";
import { paymentTone, statusTone } from "@/features/jobs/lib/job-ui";
import type { Job } from "@/features/jobs/services/jobs.service";
import { useLeads } from "@/features/leads/hooks/use-leads";
import { leadStatusTone } from "@/features/leads/lib/lead-ui";
import type { Lead } from "@/features/leads/types";
import { useQuotes } from "@/features/quotes/hooks/use-quotes";
import { quoteStatusTone } from "@/features/quotes/lib/quote-ui";
import type { Quote } from "@/features/quotes/types";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** Compact DataTable defaults for detail-page sub-lists. */
const SUB_TABLE_FEATURES = {
  rowSelection: false,
  columnOrdering: false,
  columnPinning: false,
  columnResizing: false,
  viewMode: false,
} as const;

type CustomerSale = CustomerSummary["recent_sales"][number];

export function CustomerJobsTable({
  slug,
  customerUuid,
}: {
  slug: string;
  customerUuid: string;
}) {
  const { t, locale } = useLocale();
  const query = useCustomerJobs(customerUuid, {
    limit: 100,
    offset: 0,
    sort: "-started_at",
  });
  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      createColumn<Job>({
        accessorKey: "plate",
        labelKey: "customers.related.vehicle",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.operations.detail(slug, row.original.uuid)}
            className="inline-flex items-center gap-2 hover:underline"
          >
            <BrandMark
              name={row.original.brand_name || row.original.vehicle_label}
              logoUrl={row.original.brand_logo_url}
            />
            <PlateBadge plate={row.original.plate} size="sm" />
            <span className="text-muted-foreground hidden truncate text-xs md:inline">
              {row.original.vehicle_label}
            </span>
          </Link>
        ),
      }),
      createColumn<Job>({
        accessorKey: "status",
        labelKey: "customers.related.status",
        filterVariant: "faceted",
        filterOptions: [
          "in_progress",
          "ready",
          "delivered",
          "cancelled",
          "voided",
        ].map((value) => ({
          value,
          label: value,
          labelKey: `jobs.status.${value}`,
        })),
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1.5">
            <StatusChip
              label={t(`jobs.status.${row.original.status}`)}
              tone={statusTone(row.original.status)}
            />
            <StatusChip
              label={t(`jobs.payment.${row.original.payment_status}`)}
              tone={paymentTone(row.original.payment_status)}
            />
          </span>
        ),
      }),
      createColumn<Job>({
        accessorKey: "started_at",
        labelKey: "customers.related.date",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.started_at, "dd.MM.yyyy HH:mm", locale)}
          </span>
        ),
      }),
      createColumn<Job>({
        accessorKey: "total_amount",
        labelKey: "customers.related.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.total_amount,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
    ],
    [locale, slug, t],
  );
  return (
    <EntityTable
      columns={columns}
      data={query.data?.items ?? []}
      getRowId={(row) => row.uuid}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      emptyTitle={t("customers.detail.no_jobs")}
      emptyDescription={t("customers.related.jobs_empty")}
      features={SUB_TABLE_FEATURES}
    />
  );
}

export function CustomerSalesTable({
  slug,
  sales,
}: {
  slug: string;
  sales: CustomerSale[];
}) {
  const { t, locale } = useLocale();
  const columns = useMemo<ColumnDef<CustomerSale>[]>(
    () => [
      createColumn<CustomerSale>({
        accessorKey: "sold_at",
        labelKey: "customers.related.date",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.sales.detail(slug, row.original.uuid)}
            className="font-medium tabular-nums hover:underline"
          >
            {datetime(row.original.sold_at, "dd.MM.yyyy HH:mm", locale)}
          </Link>
        ),
      }),
      createColumn<CustomerSale>({
        accessorKey: "method",
        labelKey: "customers.related.method",
        filterVariant: "faceted",
        filterOptions: ["cash", "card", "cari"].map((value) => ({
          value,
          label: value,
          labelKey: `sales.payment_method.${value}`,
        })),
        cell: ({ row }) => t(`sales.payment_method.${row.original.method}`),
      }),
      createColumn<CustomerSale>({
        accessorKey: "line_count",
        labelKey: "customers.related.lines",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.line_count}</span>
        ),
      }),
      createColumn<CustomerSale>({
        accessorKey: "status",
        labelKey: "customers.related.status",
        cell: ({ row }) => (
          <StatusChip
            label={t(`sales.status.${row.original.status}`)}
            tone={row.original.status === "posted" ? "success" : "danger"}
          />
        ),
      }),
      createColumn<CustomerSale>({
        accessorKey: "total_amount",
        labelKey: "customers.related.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.total_amount,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
    ],
    [locale, slug, t],
  );
  return (
    <EntityTable
      columns={columns}
      data={sales}
      getRowId={(row) => row.uuid}
      emptyTitle={t("customers.related.sales_none")}
      emptyDescription={t("customers.related.sales_empty")}
      features={SUB_TABLE_FEATURES}
    />
  );
}

export function CustomerQuotesTable({
  slug,
  customerUuid,
}: {
  slug: string;
  customerUuid: string;
}) {
  const { t, locale } = useLocale();
  const query = useQuotes({ customer_uuid: customerUuid, limit: 100 });
  const columns = useMemo<ColumnDef<Quote>[]>(
    () => [
      createColumn<Quote>({
        accessorKey: "number",
        labelKey: "customers.related.number",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.quotes.detail(slug, row.original.uuid)}
            className="font-mono text-xs font-medium hover:underline"
          >
            {row.original.number}
          </Link>
        ),
      }),
      createColumn<Quote>({
        accessorKey: "vehicle_label",
        labelKey: "customers.related.vehicle",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            {row.original.vehicle_brand_name ? (
              <BrandMark
                name={row.original.vehicle_brand_name}
                logoUrl={row.original.vehicle_brand_logo_url}
              />
            ) : null}
            {row.original.vehicle_plate ? (
              <PlateBadge plate={row.original.vehicle_plate} size="sm" />
            ) : null}
            <span className="text-muted-foreground truncate text-xs">
              {row.original.vehicle_label || "—"}
            </span>
          </span>
        ),
      }),
      createColumn<Quote>({
        accessorKey: "status",
        labelKey: "customers.related.status",
        filterVariant: "faceted",
        filterOptions: [
          "draft",
          "sent",
          "viewed",
          "accepted",
          "rejected",
          "expired",
          "cancelled",
        ].map((value) => ({
          value,
          label: value,
          labelKey: `quotes.status.${value}`,
        })),
        cell: ({ row }) => (
          <StatusChip
            label={t(`quotes.status.${row.original.status}`)}
            tone={quoteStatusTone(row.original.status)}
          />
        ),
      }),
      createColumn<Quote>({
        accessorKey: "created_at",
        labelKey: "customers.related.date",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.created_at, "dd.MM.yyyy", locale)}
          </span>
        ),
      }),
      createColumn<Quote>({
        accessorKey: "grand_total",
        labelKey: "customers.related.total",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {formatFinanceAmount(
              row.original.grand_total,
              row.original.currency,
              locale,
            )}
          </span>
        ),
      }),
    ],
    [locale, slug, t],
  );
  return (
    <EntityTable
      columns={columns}
      data={query.data?.items ?? []}
      getRowId={(row) => row.uuid}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      emptyTitle={t("customers.related.quotes_none")}
      emptyDescription={t("customers.related.quotes_empty")}
      features={SUB_TABLE_FEATURES}
    />
  );
}

export function CustomerLeadsTable({
  slug,
  customerUuid,
}: {
  slug: string;
  customerUuid: string;
}) {
  const { t, locale } = useLocale();
  const query = useLeads({ customer_uuid: customerUuid, limit: 100 });
  const columns = useMemo<ColumnDef<Lead>[]>(
    () => [
      createColumn<Lead>({
        accessorKey: "created_at",
        labelKey: "customers.related.date",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.tenant.leads.detail(slug, row.original.uuid)}
            className="font-medium tabular-nums hover:underline"
          >
            {datetime(row.original.created_at, "dd.MM.yyyy", locale)}
          </Link>
        ),
      }),
      createColumn<Lead>({
        accessorKey: "interest",
        labelKey: "customers.related.interest",
        filterVariant: "text",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            {row.original.vehicle_brand_name ? (
              <BrandMark
                name={row.original.vehicle_brand_name}
                logoUrl={row.original.vehicle_brand_logo_url}
              />
            ) : null}
            <span className="truncate">
              {row.original.interest || row.original.vehicle_text || "—"}
            </span>
          </span>
        ),
      }),
      createColumn<Lead>({
        accessorKey: "source",
        labelKey: "customers.related.source",
        cell: ({ row }) => t(`leads.source.${row.original.source}`),
      }),
      createColumn<Lead>({
        accessorKey: "status",
        labelKey: "customers.related.status",
        filterVariant: "faceted",
        filterOptions: ["new", "contacted", "quoted", "won", "lost"].map(
          (value) => ({
            value,
            label: value,
            labelKey: `leads.status.${value}`,
          }),
        ),
        cell: ({ row }) => (
          <StatusChip
            label={t(`leads.status.${row.original.status}`)}
            tone={leadStatusTone(row.original.status)}
          />
        ),
      }),
    ],
    [locale, slug, t],
  );
  return (
    <EntityTable
      columns={columns}
      data={query.data?.items ?? []}
      getRowId={(row) => row.uuid}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      emptyTitle={t("customers.related.leads_none")}
      emptyDescription={t("customers.related.leads_empty")}
      features={SUB_TABLE_FEATURES}
    />
  );
}
