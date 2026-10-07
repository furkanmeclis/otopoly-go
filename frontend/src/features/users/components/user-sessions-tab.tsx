"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import {
  EntityRowActions,
  EntitySectionCard,
  EntityTable,
  EntityToolbar,
  useServerListState,
  type EntityRowAction,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { UserAuthMethodsList } from "@/features/users/components/user-auth-methods";
import {
  useRevokeAllUserSessions,
  useRevokeUserSession,
} from "@/features/users/hooks/use-user-mutations";
import { useUserSessions } from "@/features/users/hooks/use-users-query";
import type {
  PlatformUserDetail,
  UserSession,
} from "@/features/users/services/users.service";
import { userFullName } from "@/features/users/lib/user-display";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type UserSessionsTabProps = {
  user: PlatformUserDetail;
};

/**
 * Linked sign-in methods and active refresh sessions (metadata only — token
 * values never reach the browser). Revoking is step-up gated and audited.
 */
export function UserSessionsTab({ user }: UserSessionsTabProps) {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const { confirmDelete } = useDialogs();
  const listState = useServerListState({ initialPageSize: 20 });
  const query = useUserSessions(user.uuid, listState.params);
  const revoke = useRevokeUserSession();
  const revokeAll = useRevokeAllUserSessions();

  const canWrite = can(permissions.users.write) && !user.deleted_at;
  const total = query.data?.total ?? 0;
  const name = userFullName(user);

  const columns = useMemo(() => {
    const base = [
      createColumn<UserSession>({
        id: "device",
        accessorFn: (row) => row.user_agent ?? "",
        labelKey: "users.sessions.columns.device",
        enableSorting: false,
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className="max-w-[28rem] truncate text-sm"
              title={row.original.user_agent ?? undefined}
            >
              {row.original.user_agent || t("users.sessions.unknown_device")}
            </span>
            {row.original.impersonated ? (
              <Badge variant="outline" className="w-fit text-[10px]">
                {t("users.sessions.impersonated")}
              </Badge>
            ) : null}
          </div>
        ),
      }),
      createColumn<UserSession>({
        id: "ip_address",
        accessorFn: (row) => row.ip_address ?? "",
        labelKey: "users.sessions.columns.ip_address",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.ip_address || "—"}
          </span>
        ),
      }),
      createColumn<UserSession>({
        id: "organization",
        accessorFn: (row) => row.organization?.name ?? "",
        labelKey: "users.sessions.columns.organization",
        enableSorting: false,
        cell: ({ row }) => {
          const org = row.original.organization;
          if (!org) {
            return (
              <span className="text-muted-foreground">
                {t("users.sessions.platform_context")}
              </span>
            );
          }
          return (
            <Link
              href={routes.platform.organizations.detail(org.uuid)}
              className="hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {org.name}
            </Link>
          );
        },
      }),
      createColumn<UserSession>({
        accessorKey: "last_used_at",
        labelKey: "users.sessions.columns.last_used_at",
        enableSorting: false,
        gridSecondary: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {datetime(row.original.last_used_at, undefined, locale)}
          </span>
        ),
      }),
      createColumn<UserSession>({
        accessorKey: "expires_at",
        labelKey: "users.sessions.columns.expires_at",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {datetime(row.original.expires_at, undefined, locale)}
          </span>
        ),
      }),
    ] as ColumnDef<UserSession, unknown>[];

    if (!canWrite) return base;

    base.push(
      createColumn<UserSession>({
        id: "actions",
        labelKey: "users.sessions.columns.actions",
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) => {
          const actions: EntityRowAction[] = [
            {
              id: "revoke",
              label: t("users.sessions.revoke"),
              icon: LogOut,
              permission: permissions.users.write,
              variant: "destructive",
              onSelect: async () => {
                const confirmed = await confirmDelete({
                  title: t("users.sessions.revoke_title"),
                  description: t("users.sessions.revoke_description", {
                    name,
                  }),
                  confirmLabel: t("users.sessions.revoke"),
                });
                if (!confirmed) return;
                await revoke
                  .mutateAsync({
                    uuid: user.uuid,
                    sessionUuid: row.original.uuid,
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
  }, [canWrite, confirmDelete, locale, name, revoke, t, user.uuid]);

  const limit = listState.params.limit || 20;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const handleRevokeAll = async () => {
    const confirmed = await confirmDelete({
      title: t("users.sessions.revoke_all_title"),
      description: t("users.sessions.revoke_all_description", { name }),
      confirmLabel: t("users.sessions.revoke_all"),
    });
    if (!confirmed) return;
    await revokeAll.mutateAsync(user.uuid).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      <EntitySectionCard title={t("users.detail.auth_methods")}>
        <UserAuthMethodsList methods={user.auth_methods ?? []} />
      </EntitySectionCard>

      <EntitySectionCard
        title={t("users.sessions.title")}
        badge={query.data?.total}
        action={
          canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={total === 0 || revokeAll.isPending}
              onClick={() => void handleRevokeAll()}
            >
              <LogOut className="size-4" />
              {t("users.sessions.revoke_all")}
            </Button>
          ) : null
        }
      >
        <p className="text-muted-foreground mb-3 text-xs">
          {t("users.sessions.hint")}
        </p>
        <EntityTable
          columns={columns}
          data={query.data?.items ?? []}
          getRowId={(row) => row.uuid}
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          emptyTitle={t("users.sessions.empty_title")}
          emptyDescription={t("users.sessions.empty_description")}
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
    </div>
  );
}
