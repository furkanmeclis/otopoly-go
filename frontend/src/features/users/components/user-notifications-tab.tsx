"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

import { StatusChip } from "@/components/common/status-chip";
import {
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { NotificationDetailDrawer } from "@/features/notifications/components/notification-detail-drawer";
import type { NotificationRowActionHandlers } from "@/features/notifications/components/notification-row-actions";
import { useNotificationsColumns } from "@/features/notifications/components/notifications-columns";
import {
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_INBOX_CHANNEL,
} from "@/features/notifications/constants";
import { usePlatformNotificationsList } from "@/features/notifications/hooks/use-notifications-query";
import type {
  ListPlatformNotificationsParams,
  Notification,
} from "@/features/notifications/services/notifications.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type UserNotificationsTabProps = {
  userUuid: string;
};

function firstString(value: unknown) {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return typeof value === "string" ? value : undefined;
}

/**
 * Notifications sent to the user on every channel (in-app, push, email, …)
 * with read state. Reuses the platform notifications list (`user_uuid`).
 */
export function UserNotificationsTab({ userUuid }: UserNotificationsTabProps) {
  const { t, locale } = useLocale();
  const listState = useServerListState({
    initialSort: "-created_at",
    initialPageSize: 20,
  });
  const [selected, setSelected] = useState<Notification | null>(null);

  const params = useMemo<ListPlatformNotificationsParams>(() => {
    const columnValue = (id: string) =>
      firstString(
        listState.columnFilters.find((filter) => filter.id === id)?.value,
      );
    return {
      ...listState.params,
      q: listState.params.q || columnValue("title")?.trim() || undefined,
      status: columnValue("status"),
      channel: columnValue("channel"),
      user_uuid: userUuid,
    };
  }, [listState.columnFilters, listState.params, userUuid]);

  const query = usePlatformNotificationsList(params);

  const openDetail = useCallback((notification: Notification) => {
    setSelected(notification);
  }, []);
  const handlers = useMemo<NotificationRowActionHandlers>(
    () => ({ onView: openDetail }),
    [openDetail],
  );
  const baseColumns = useNotificationsColumns(handlers);

  const columns = useMemo(() => {
    const channel = createColumn<Notification>({
      accessorKey: "channel",
      labelKey: "notifications.columns.channel",
      enableSorting: false,
      filterVariant: "faceted",
      filterOptions: NOTIFICATION_CHANNEL_VALUES.map((value) => ({
        value,
        labelKey: `notifications.channel.${value}`,
        label: value,
      })),
      cell: ({ row }) => {
        const key = `notifications.channel.${row.original.channel}`;
        const label = t(key);
        return label === key ? row.original.channel : label;
      },
    });
    const read = createColumn<Notification>({
      id: "read_state",
      accessorFn: (row) => row.read_at ?? "",
      labelKey: "users.notifications.columns.read",
      enableSorting: false,
      enableColumnFilter: false,
      cell: ({ row }) => {
        if (row.original.channel !== NOTIFICATION_INBOX_CHANNEL) {
          return <span className="text-muted-foreground">—</span>;
        }
        return row.original.read_at ? (
          <span title={datetime(row.original.read_at, undefined, locale)}>
            <StatusChip label={t("users.notifications.read")} tone="success" />
          </span>
        ) : (
          <StatusChip label={t("users.notifications.unread")} tone="warning" />
        );
      },
    });
    // title, channel, status, read state, …rest (actions stay last).
    const [title, ...rest] = baseColumns;
    return [title, channel, rest[0], read, ...rest.slice(1)] as ColumnDef<
      Notification,
      unknown
    >[];
  }, [baseColumns, locale, t]);

  const limit = listState.pagination.pageSize || 20;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / limit));

  return (
    <>
      <EntityTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={openDetail}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        emptyTitle={t("users.notifications.empty_title")}
        emptyDescription={t("users.notifications.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        features={{
          persistKey: "platform-user-notifications-v1",
          rowSelection: false,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void query.refetch()}
            refreshDisabled={query.isFetching}
          />
        }
      />
      <NotificationDetailDrawer
        notification={selected}
        open={Boolean(selected)}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      />
    </>
  );
}
