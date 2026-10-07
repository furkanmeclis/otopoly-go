"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";

import { StatusChip } from "@/components/common/status-chip";
import {
  EntityRowActions,
  EntitySectionCard,
  EntityTable,
  EntityToolbar,
  useServerListState,
  type EntityRowAction,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { permissions } from "@/config/permissions";
import { useRemoveUserDevice } from "@/features/users/hooks/use-user-mutations";
import { useUserDevices } from "@/features/users/hooks/use-users-query";
import type {
  PlatformUserDetail,
  UserPushDevice,
} from "@/features/users/services/users.service";
import { userFullName } from "@/features/users/lib/user-display";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type UserDevicesTabProps = {
  user: PlatformUserDetail;
};

/** Mobile push devices (the push token is never sent). Removal is step-up gated. */
export function UserDevicesTab({ user }: UserDevicesTabProps) {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const { confirmDelete } = useDialogs();
  const listState = useServerListState({ initialPageSize: 20 });
  const query = useUserDevices(user.uuid, listState.params);
  const remove = useRemoveUserDevice();

  const canWrite = can(permissions.users.write) && !user.deleted_at;
  const name = userFullName(user);

  const columns = useMemo(() => {
    const base = [
      createColumn<UserPushDevice>({
        id: "device",
        accessorFn: (row) => row.device_name,
        labelKey: "users.devices.columns.device",
        enableSorting: false,
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              {row.original.device_name || t("users.devices.unnamed")}
            </span>
            {row.original.app_version ? (
              <span className="text-muted-foreground text-xs">
                {t("users.devices.app_version", {
                  version: row.original.app_version,
                })}
              </span>
            ) : null}
          </div>
        ),
      }),
      createColumn<UserPushDevice>({
        accessorKey: "platform",
        labelKey: "users.devices.columns.platform",
        enableSorting: false,
        cell: ({ row }) => t(`users.devices.platform.${row.original.platform}`),
      }),
      createColumn<UserPushDevice>({
        id: "state",
        accessorFn: (row) => (row.disabled_at ? "disabled" : "active"),
        labelKey: "users.devices.columns.state",
        enableSorting: false,
        gridSecondary: true,
        cell: ({ row }) =>
          row.original.disabled_at ? (
            <span title={row.original.disabled_reason || undefined}>
              <StatusChip
                label={t("users.devices.state.disabled")}
                tone="danger"
              />
            </span>
          ) : (
            <StatusChip
              label={t("users.devices.state.active")}
              tone="success"
            />
          ),
      }),
      createColumn<UserPushDevice>({
        accessorKey: "last_seen_at",
        labelKey: "users.devices.columns.last_seen_at",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {datetime(row.original.last_seen_at, undefined, locale)}
          </span>
        ),
      }),
      createColumn<UserPushDevice>({
        accessorKey: "created_at",
        labelKey: "users.devices.columns.created_at",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {datetime(row.original.created_at, undefined, locale)}
          </span>
        ),
      }),
    ] as ColumnDef<UserPushDevice, unknown>[];

    if (!canWrite) return base;

    base.push(
      createColumn<UserPushDevice>({
        id: "actions",
        labelKey: "users.devices.columns.actions",
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) => {
          const actions: EntityRowAction[] = [
            {
              id: "remove",
              label: t("users.devices.remove"),
              icon: Trash2,
              permission: permissions.users.write,
              variant: "destructive",
              onSelect: async () => {
                const confirmed = await confirmDelete({
                  title: t("users.devices.remove_title"),
                  description: t("users.devices.remove_description", {
                    device:
                      row.original.device_name || t("users.devices.unnamed"),
                    name,
                  }),
                  confirmLabel: t("users.devices.remove"),
                });
                if (!confirmed) return;
                await remove
                  .mutateAsync({
                    uuid: user.uuid,
                    deviceUuid: row.original.uuid,
                  })
                  .catch(() => undefined);
              },
            },
          ];
          return <EntityRowActions actions={actions} />;
        },
      }),
    );
    return base;
  }, [canWrite, confirmDelete, locale, name, remove, t, user.uuid]);

  const limit = listState.params.limit || 20;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / limit));

  return (
    <EntitySectionCard
      title={t("users.devices.title")}
      badge={query.data?.total}
    >
      <EntityTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.uuid}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        emptyTitle={t("users.devices.empty_title")}
        emptyDescription={t("users.devices.empty_description")}
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
    </EntitySectionCard>
  );
}
