"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";

import {
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { routes } from "@/config/routes";
import { formatActivityResource } from "@/features/io/lib/display";
import { useOrganizationActivity } from "@/features/organizations/hooks/use-organizations-query";
import type { OrganizationActivityEntry } from "@/features/organizations/services/organizations.service";
import { userFullName } from "@/features/users/lib/user-display";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type OrganizationActivityTabProps = {
  organizationUuid: string;
};

/** Activity log filtered to one organization (server-paged). */
export function OrganizationActivityTab({
  organizationUuid,
}: OrganizationActivityTabProps) {
  const { t, locale } = useLocale();
  const listState = useServerListState({ initialPageSize: 20 });
  const query = useOrganizationActivity(organizationUuid, listState.params);

  const columns = useMemo<ColumnDef<OrganizationActivityEntry>[]>(
    () => [
      createColumn<OrganizationActivityEntry>({
        accessorKey: "created_at",
        labelKey: "activity.columns.created_at",
        enableSorting: false,
        gridSecondary: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {datetime(row.original.created_at, undefined, locale)}
          </span>
        ),
      }),
      createColumn<OrganizationActivityEntry>({
        accessorKey: "action",
        labelKey: "activity.columns.action",
        enableSorting: false,
        gridPrimary: true,
        cell: ({ row }) => {
          const key = `activity.actions.${row.original.action}`;
          const label = t(key);
          return (
            <span className="font-medium">
              {label === key ? row.original.action : label}
            </span>
          );
        },
      }),
      createColumn<OrganizationActivityEntry>({
        accessorKey: "resource",
        labelKey: "activity.columns.resource",
        enableSorting: false,
        cell: ({ row }) => formatActivityResource(t, row.original.resource),
      }),
      createColumn<OrganizationActivityEntry>({
        id: "actor",
        labelKey: "activity.columns.actor",
        enableSorting: false,
        accessorFn: (row) => row.actor?.email ?? "",
        cell: ({ row }) => {
          const actor = row.original.actor;
          if (!actor) {
            return (
              <span className="text-muted-foreground">
                {t("organizations.activity.system")}
              </span>
            );
          }
          return (
            <Link
              href={routes.platform.users.detail(actor.uuid)}
              className="hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {userFullName(actor) || actor.email}
            </Link>
          );
        },
      }),
    ],
    [locale, t],
  );

  const limit = listState.params.limit || 20;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / limit));

  return (
    <EntityTable
      columns={columns}
      data={query.data?.items ?? []}
      getRowId={(row) => row.uuid}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      emptyTitle={t("organizations.activity.empty_title")}
      emptyDescription={t("organizations.activity.empty_description")}
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
        globalFilter: true,
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
  );
}
