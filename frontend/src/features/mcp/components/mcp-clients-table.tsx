"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Ban } from "lucide-react";
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
import { permissions } from "@/config/permissions";
import {
  useMcpClients,
  useRevokeMcpClient,
} from "@/features/mcp/hooks/use-mcp";
import type { McpClient } from "@/features/mcp/services/mcp.service";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

/**
 * Every registered MCP (OAuth) client, platform wide. Blocking a client
 * revokes every connection and token issued to it.
 */
export function McpClientsTable() {
  const { t, locale } = useLocale();
  const { confirmDelete } = useDialogs();
  const listState = useServerListState({ initialPageSize: 20 });
  const query = useMcpClients({
    limit: listState.params.limit,
    offset: listState.params.offset,
    q: listState.params.q,
  });
  const revoke = useRevokeMcpClient();
  const total = query.data?.total ?? 0;

  const columns = useMemo(
    () =>
      [
        createColumn<McpClient>({
          id: "client",
          accessorFn: (row) => row.client_name,
          labelKey: "mcp.clients.columns.client",
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
        createColumn<McpClient>({
          id: "redirect_uris",
          accessorFn: (row) => row.redirect_uris.join(" "),
          labelKey: "mcp.clients.columns.redirect_uris",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex max-w-[22rem] flex-col gap-0.5">
              {row.original.redirect_uris.map((uri) => (
                <span
                  key={uri}
                  className="truncate font-mono text-xs"
                  title={uri}
                >
                  {uri}
                </span>
              ))}
            </div>
          ),
        }),
        createColumn<McpClient>({
          accessorKey: "status",
          labelKey: "mcp.clients.columns.status",
          enableSorting: false,
          cell: ({ row }) =>
            row.original.status === "revoked" ? (
              <Badge variant="danger">{t("mcp.clients.status.revoked")}</Badge>
            ) : (
              <Badge variant="success">{t("mcp.clients.status.active")}</Badge>
            ),
        }),
        createColumn<McpClient>({
          accessorKey: "active_grants",
          labelKey: "mcp.clients.columns.active_grants",
          enableSorting: false,
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.active_grants}</span>
          ),
        }),
        createColumn<McpClient>({
          accessorKey: "created_at",
          labelKey: "mcp.clients.columns.created_at",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex flex-col gap-0.5">
              <span className="whitespace-nowrap tabular-nums">
                {datetime(row.original.created_at, undefined, locale)}
              </span>
              {row.original.created_ip ? (
                <span className="text-muted-foreground font-mono text-[11px]">
                  {row.original.created_ip}
                </span>
              ) : null}
            </div>
          ),
        }),
        createColumn<McpClient>({
          accessorKey: "last_used_at",
          labelKey: "mcp.clients.columns.last_used_at",
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
        createColumn<McpClient>({
          id: "actions",
          labelKey: "mcp.clients.columns.actions",
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          cell: ({ row }) => {
            const actions: EntityRowAction[] = [
              {
                id: "revoke",
                label: t("mcp.clients.revoke"),
                icon: Ban,
                permission: permissions.mcp.manage,
                variant: "destructive",
                disabled: row.original.status === "revoked",
                onSelect: async () => {
                  const confirmed = await confirmDelete({
                    title: t("mcp.clients.revoke_title"),
                    description: t("mcp.clients.revoke_description", {
                      name: row.original.client_name,
                    }),
                    confirmLabel: t("mcp.clients.revoke"),
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
      ] as ColumnDef<McpClient, unknown>[],
    [confirmDelete, locale, revoke, t],
  );

  const limit = listState.params.limit || 20;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <EntityTable
      columns={columns}
      data={query.data?.items ?? []}
      getRowId={(row) => row.uuid}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      emptyTitle={t("mcp.clients.empty_title")}
      emptyDescription={t("mcp.clients.empty_description")}
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
