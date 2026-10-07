"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import {
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useOutboundMessages } from "@/features/messaging/hooks/use-messaging";
import { sendErrorLabel } from "@/features/messaging/lib/send-errors";
import type { OutboundMessage } from "@/features/messaging/types";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type Tone = "default" | "success" | "warning" | "danger";

const DELIVERY_TONES: Record<string, Tone> = {
  queued: "default",
  sending: "warning",
  sent: "default",
  delivered: "success",
  read: "success",
  failed: "danger",
};

const DELIVERY_KEYS: Record<string, string> = {
  queued: "messaging.outbound.status.queued",
  sending: "messaging.outbound.status.sending",
  sent: "messaging.outbound.status.sent",
  delivered: "messaging.outbound.status.delivered",
  read: "messaging.outbound.status.read",
  failed: "messaging.outbound.status.failed",
};

const SENDER_KEYS: Record<string, string> = {
  org_own: "messaging.outbound.sender.org_own",
  platform_whatsmeow: "messaging.outbound.sender.platform",
  platform_cloud: "messaging.outbound.sender.platform",
};

/** Webhook delivery status wins over the local send status, except on failure. */
function effectiveStatus(row: OutboundMessage): string {
  if (row.status === "failed") return "failed";
  return row.delivery_status || row.status;
}

export function OutboundLogCard() {
  const { t, locale } = useLocale();
  const listState = useServerListState({ initialPageSize: 20 });
  const params = useMemo(
    () => ({ limit: listState.params.limit, offset: listState.params.offset }),
    [listState.params.limit, listState.params.offset],
  );
  const query = useOutboundMessages(params);

  const columns = useMemo<ColumnDef<OutboundMessage>[]>(
    () => [
      createColumn<OutboundMessage>({
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
      createColumn<OutboundMessage>({
        accessorKey: "recipient_phone",
        labelKey: "messaging.outbound.columns.recipient",
        enableSorting: false,
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.recipient_phone}
          </span>
        ),
      }),
      createColumn<OutboundMessage>({
        accessorKey: "event_type",
        labelKey: "messaging.outbound.columns.event",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.event_type}</span>
        ),
      }),
      createColumn<OutboundMessage>({
        id: "sender_kind",
        labelKey: "messaging.outbound.columns.sender",
        enableSorting: false,
        accessorFn: (row) => row.sender_kind ?? "",
        cell: ({ row }) => {
          const kind = row.original.sender_kind;
          if (!kind) return <span className="text-muted-foreground">—</span>;
          return (
            <Badge
              variant={kind === "org_own" ? "secondary" : "outline"}
              className="whitespace-nowrap"
            >
              {t(SENDER_KEYS[kind] ?? "messaging.outbound.sender.platform")}
            </Badge>
          );
        },
      }),
      createColumn<OutboundMessage>({
        id: "template_name",
        labelKey: "messaging.outbound.columns.template",
        enableSorting: false,
        accessorFn: (row) => row.template_name ?? "",
        cell: ({ row }) =>
          row.original.template_name ? (
            <span className="font-mono text-xs">
              {row.original.template_name}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      createColumn<OutboundMessage>({
        id: "delivery",
        labelKey: "messaging.outbound.columns.status",
        enableSorting: false,
        accessorFn: (row) => effectiveStatus(row),
        cell: ({ row }) => {
          const value = effectiveStatus(row.original);
          return (
            <StatusChip
              label={DELIVERY_KEYS[value] ? t(DELIVERY_KEYS[value]) : value}
              tone={DELIVERY_TONES[value] ?? "default"}
            />
          );
        },
      }),
      createColumn<OutboundMessage>({
        id: "error_code",
        labelKey: "messaging.outbound.columns.error",
        enableSorting: false,
        accessorFn: (row) => row.error_code ?? "",
        cell: ({ row }) => {
          const code = row.original.error_code;
          if (!code) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex max-w-xs flex-col gap-0.5">
              <span className="text-sm">{sendErrorLabel(t, code)}</span>
              <span className="text-muted-foreground font-mono text-[11px]">
                {code}
              </span>
            </div>
          );
        },
      }),
    ],
    [locale, t],
  );

  const pageCount = Math.max(
    1,
    Math.ceil((query.data?.total ?? 0) / (params.limit || 20)),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-5" />
          {t("messaging.outbound.title")}
        </CardTitle>
        <CardDescription>{t("messaging.outbound.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <EntityTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => row.uuid}
          isLoading={query.isLoading}
          isError={query.isError}
          errorDescription={t("messaging.outbound.error")}
          onRetry={() => void query.refetch()}
          emptyTitle={t("messaging.outbound.empty_title")}
          emptyDescription={t("messaging.outbound.empty_description")}
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
  );
}
