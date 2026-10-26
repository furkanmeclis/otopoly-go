"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { PageHeader } from "@/components/layout/page-header";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { sendErrorLabel } from "@/features/messaging/lib/send-errors";
import {
  smsReportKeys,
  smsReportService,
  type SmsReportMessage,
} from "@/features/platform-sms/services/sms-report.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type Tone = "default" | "success" | "warning" | "danger";
const STATUS_TONES: Record<string, Tone> = {
  queued: "default",
  sending: "warning",
  sent: "success",
  failed: "danger",
};

export function SmsOrgMessagesPage({ uuid }: { uuid: string }) {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const canRead = can(permissions.platformSms.read);
  const listState = useServerListState({ initialPageSize: 20 });
  const params = useMemo(
    () => ({ limit: listState.params.limit, offset: listState.params.offset }),
    [listState.params.limit, listState.params.offset],
  );
  const query = useQuery({
    queryKey: smsReportKeys.messages(uuid, params),
    queryFn: () => smsReportService.messages(uuid, params),
    enabled: canRead,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<SmsReportMessage>[]>(
    () => [
      createColumn<SmsReportMessage>({
        accessorKey: "created_at",
        labelKey: "messaging.outbound.columns.time",
        enableSorting: false,
        gridSecondary: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {datetime(
              row.original.sent_at || row.original.created_at,
              "dd.MM.yyyy HH:mm",
              locale,
            )}
          </span>
        ),
      }),
      createColumn<SmsReportMessage>({
        accessorKey: "recipient",
        labelKey: "messaging.outbound.columns.recipient",
        enableSorting: false,
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.recipient}</span>
        ),
      }),
      createColumn<SmsReportMessage>({
        accessorKey: "event_type",
        labelKey: "messaging.outbound.columns.event",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.event_type}</span>
        ),
      }),
      createColumn<SmsReportMessage>({
        accessorKey: "provider",
        labelKey: "messaging.platform_report.columns.provider",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.provider === "netgsm" ||
          row.original.provider === "twilio" ? (
            t(`messaging.sms.providers.${row.original.provider}.name`)
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      createColumn<SmsReportMessage>({
        accessorKey: "status",
        labelKey: "messaging.outbound.columns.status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusChip
            label={t(`messaging.outbound.status.${row.original.status}`)}
            tone={STATUS_TONES[row.original.status] ?? "default"}
          />
        ),
      }),
      createColumn<SmsReportMessage>({
        id: "segments",
        accessorFn: (row) => row.segments ?? 0,
        labelKey: "messaging.platform_report.columns.segments",
        enableSorting: false,
        cell: ({ row }) => row.original.segments ?? "—",
      }),
      createColumn<SmsReportMessage>({
        id: "error_code",
        accessorFn: (row) => row.error_code ?? "",
        labelKey: "messaging.outbound.columns.error",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.error_code ? (
            <span className="text-sm">
              {sendErrorLabel(t, row.original.error_code, "sms")}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
    ],
    [locale, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("messaging.platform_report.forbidden")}
      />
    );
  }

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / params.limit));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<MessageSquareText className="size-7" />}
        title={t("messaging.platform_report.org_title", {
          name: query.data?.organization.name ?? "",
        })}
        description={t("messaging.platform_report.org_description")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={routes.platform.smsReport.root}>
              <ArrowLeft className="mr-2 size-4" />
              {t("messaging.platform_report.back")}
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <EntityTable
            columns={columns}
            data={query.data?.items ?? []}
            getRowId={(row) => row.uuid}
            isLoading={query.isLoading}
            isError={query.isError}
            errorDescription={t("messaging.platform_report.error")}
            onRetry={() => void query.refetch()}
            emptyTitle={t("messaging.platform_report.org_empty")}
            emptyDescription={t("messaging.platform_report.org_empty_hint")}
            pageCount={pageCount}
            state={{
              pagination: listState.pagination,
              onPaginationChange: listState.onPaginationChange,
            }}
            manual={{ pagination: true }}
            features={{
              sorting: false,
              globalFilter: false,
              columnFilters: false,
              facetedFilters: false,
            }}
            toolbarExtra={
              <EntityToolbar
                onRefresh={() => void query.refetch()}
                refreshDisabled={query.isFetching}
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
