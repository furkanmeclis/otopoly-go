"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Unplug } from "lucide-react";
import { useMemo } from "react";

import {
  EntityRowActions,
  EntityTable,
  EntityToolbar,
  useServerListState,
  type EntityRowAction,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import { useMcpGrants, useRevokeMcpGrant } from "@/features/mcp/hooks/use-mcp";
import type { McpGrant } from "@/features/mcp/services/mcp.service";
import { ScopeBadges } from "@/features/mcp/components/scope-badges";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

type ConnectedAppsTableProps = {
  /** Only connections of one endpoint. */
  realm?: "org" | "platform";
  /** Only connections bound to one organization. */
  organizationUuid?: string;
};

/**
 * The signed-in user's MCP connections (OAuth grants). Disconnecting revokes
 * the grant and every token issued under it at once.
 */
export function ConnectedAppsTable({
  realm,
  organizationUuid,
}: ConnectedAppsTableProps) {
  const { t, locale } = useLocale();
  const { confirmDelete } = useDialogs();
  const listState = useServerListState({ initialPageSize: 10 });
  const query = useMcpGrants({
    limit: listState.params.limit,
    offset: listState.params.offset,
    q: listState.params.q,
    realm,
    organization_uuid: organizationUuid,
  });
  const revoke = useRevokeMcpGrant();
  const total = query.data?.total ?? 0;

  const columns = useMemo(
    () =>
      [
        createColumn<McpGrant>({
          id: "client",
          accessorFn: (row) => row.client_name,
          labelKey: "mcp.grants.columns.client",
          enableSorting: false,
          gridPrimary: true,
          cell: ({ row }) => (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">
                {row.original.client_name}
              </span>
              <span className="text-muted-foreground truncate font-mono text-[11px]">
                {row.original.client_id}
              </span>
            </div>
          ),
        }),
        createColumn<McpGrant>({
          id: "connection",
          accessorFn: (row) => row.organization_name ?? "",
          labelKey: "mcp.grants.columns.connection",
          enableSorting: false,
          cell: ({ row }) =>
            row.original.realm === "platform" ? (
              <Badge variant="secondary">{t("mcp.realm.platform")}</Badge>
            ) : (
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate">
                  {row.original.organization_name ?? "—"}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("mcp.realm.org")}
                </span>
              </div>
            ),
        }),
        createColumn<McpGrant>({
          id: "scopes",
          accessorFn: (row) => row.scopes.join(" "),
          labelKey: "mcp.grants.columns.scopes",
          enableSorting: false,
          cell: ({ row }) => <ScopeBadges scopes={row.original.scopes} />,
        }),
        createColumn<McpGrant>({
          accessorKey: "created_at",
          labelKey: "mcp.grants.columns.created_at",
          enableSorting: false,
          cell: ({ row }) => (
            <span className="whitespace-nowrap tabular-nums">
              {datetime(row.original.created_at, undefined, locale)}
            </span>
          ),
        }),
        createColumn<McpGrant>({
          accessorKey: "last_used_at",
          labelKey: "mcp.grants.columns.last_used_at",
          enableSorting: false,
          gridSecondary: true,
          cell: ({ row }) => (
            <span className="whitespace-nowrap tabular-nums">
              {row.original.last_used_at
                ? datetime(row.original.last_used_at, undefined, locale)
                : t("mcp.grants.never_used")}
            </span>
          ),
        }),
        createColumn<McpGrant>({
          id: "actions",
          labelKey: "mcp.grants.columns.actions",
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          cell: ({ row }) => {
            const actions: EntityRowAction[] = [
              {
                id: "revoke",
                label: t("mcp.grants.revoke"),
                icon: Unplug,
                variant: "destructive",
                onSelect: async () => {
                  const confirmed = await confirmDelete({
                    title: t("mcp.grants.revoke_title"),
                    description: t("mcp.grants.revoke_description", {
                      name: row.original.client_name,
                    }),
                    confirmLabel: t("mcp.grants.revoke"),
                  });
                  if (!confirmed) return;
                  await revoke
                    .mutateAsync(row.original.uuid)
                    .catch(() => undefined);
                },
              },
            ];
            return <EntityRowActions actions={actions} />;
          },
        }),
      ] as ColumnDef<McpGrant, unknown>[],
    [confirmDelete, locale, revoke, t],
  );

  const limit = listState.params.limit || 10;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <EntityTable
      columns={columns}
      data={query.data?.items ?? []}
      getRowId={(row) => row.uuid}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      emptyTitle={t("mcp.grants.empty_title")}
      emptyDescription={t("mcp.grants.empty_description")}
      pageCount={pageCount}
      state={{
        pagination: listState.pagination,
        onPaginationChange: listState.onPaginationChange,
        globalFilter: listState.globalFilter,
        onGlobalFilterChange: listState.onGlobalFilterChange,
      }}
      manual={{ pagination: true, filtering: true }}
      features={{
        sorting: false,
        columnFilters: false,
        facetedFilters: false,
        rowSelection: false,
      }}
      toolbarExtra={
        <EntityToolbar
          onRefresh={() => void query.refetch()}
          refreshDisabled={query.isFetching}
        />
      }
    />
  );
}
