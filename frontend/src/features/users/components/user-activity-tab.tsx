"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routes } from "@/config/routes";
import { formatActivityResource } from "@/features/io/lib/display";
import {
  useUserActivity,
  useUserOrganizations,
} from "@/features/users/hooks/use-users-query";
import type { UserActivityEntry } from "@/features/users/services/users.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type UserActivityTabProps = {
  userUuid: string;
};

const ALL = "all";

/**
 * Activity the user performed (server-paged), filterable by organization.
 * The filter is URL-synced (`?org=`) so it can be deep-linked.
 */
export function UserActivityTab({ userUuid }: UserActivityTabProps) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const organizationUuid = searchParams.get("org") ?? undefined;
  const listState = useServerListState({ initialPageSize: 20 });
  const query = useUserActivity(userUuid, {
    ...listState.params,
    organization_uuid: organizationUuid,
  });
  // Filter options: the user's organizations (first 100 memberships).
  const memberships = useUserOrganizations(userUuid, { limit: 100, offset: 0 });

  const selectOrganization = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) params.delete("org");
    else params.set("org", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    listState.onPaginationChange({
      pageIndex: 0,
      pageSize: listState.pagination.pageSize,
    });
  };

  const columns = useMemo<ColumnDef<UserActivityEntry>[]>(
    () => [
      createColumn<UserActivityEntry>({
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
      createColumn<UserActivityEntry>({
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
      createColumn<UserActivityEntry>({
        accessorKey: "resource",
        labelKey: "activity.columns.resource",
        enableSorting: false,
        cell: ({ row }) => formatActivityResource(t, row.original.resource),
      }),
      createColumn<UserActivityEntry>({
        id: "organization",
        accessorFn: (row) => row.organization?.name ?? "",
        labelKey: "users.activity.columns.organization",
        enableSorting: false,
        cell: ({ row }) => {
          const org = row.original.organization;
          if (!org) {
            return (
              <span className="text-muted-foreground">
                {t("users.activity.platform")}
              </span>
            );
          }
          return (
            <Link
              href={routes.platform.organizations.detail(org.uuid, "activity")}
              className="hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {org.name}
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
      emptyTitle={t("users.activity.empty_title")}
      emptyDescription={t("users.activity.empty_description")}
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
        <>
          <Select
            value={organizationUuid ?? ALL}
            onValueChange={selectOrganization}
          >
            <SelectTrigger
              className="h-8 w-[220px]"
              aria-label={t("users.activity.filter_organization")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("users.activity.all_organizations")}
              </SelectItem>
              {(memberships.data?.items ?? []).map((membership) => (
                <SelectItem
                  key={membership.organization.uuid}
                  value={membership.organization.uuid}
                >
                  {membership.organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <EntityToolbar
            onRefresh={() => void query.refetch()}
            refreshDisabled={query.isFetching}
          />
        </>
      }
    />
  );
}
