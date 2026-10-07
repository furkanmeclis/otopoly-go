"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, ShieldCheck, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PermissionGuard } from "@/components/common/permission-guard";
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
import { Button } from "@/components/ui/button";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { organizationStatusTone } from "@/features/organizations/constants";
import {
  useChangeOrganizationMemberRole,
  useRemoveOrganizationMember,
} from "@/features/organizations/hooks/use-organization-mutations";
import { UserAddMembershipDialog } from "@/features/users/components/user-add-membership-dialog";
import { useInvalidateUserInsights } from "@/features/users/hooks/use-user-mutations";
import { useUserOrganizations } from "@/features/users/hooks/use-users-query";
import type { UserMembership } from "@/features/users/services/users.service";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type UserOrganizationsTabProps = {
  userUuid: string;
  userName: string;
  /** Deleted users are read-only. */
  readOnly?: boolean;
};

/**
 * Organizations the user belongs to (server-paged). Add / change role /
 * remove reuse the platform organization members endpoints; the API refuses
 * to demote or remove the last owner (`LAST_ORGANIZATION_OWNER`).
 */
export function UserOrganizationsTab({
  userUuid,
  userName,
  readOnly,
}: UserOrganizationsTabProps) {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const { confirm, confirmDelete } = useDialogs();
  const listState = useServerListState({ initialPageSize: 20 });
  const query = useUserOrganizations(userUuid, listState.params);
  const changeRole = useChangeOrganizationMemberRole();
  const removeMember = useRemoveOrganizationMember();
  const invalidate = useInvalidateUserInsights();
  const [addOpen, setAddOpen] = useState(false);

  const canWrite = can(permissions.organizations.write) && !readOnly;

  const columns = useMemo(() => {
    const base = [
      createColumn<UserMembership>({
        id: "organization",
        accessorFn: (row) => row.organization.name,
        labelKey: "users.memberships.columns.organization",
        enableSorting: false,
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.platform.organizations.detail(
              row.original.organization.uuid,
              "members",
            )}
            className="font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.organization.name}
          </Link>
        ),
      }),
      createColumn<UserMembership>({
        accessorKey: "role",
        labelKey: "users.memberships.columns.role",
        enableSorting: false,
        gridSecondary: true,
        cell: ({ row }) => (
          <StatusChip
            label={t(`organizations.roles.${row.original.role}`)}
            tone={row.original.role === "owner" ? "success" : "default"}
          />
        ),
      }),
      createColumn<UserMembership>({
        accessorKey: "joined_at",
        labelKey: "users.memberships.columns.joined_at",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {datetime(row.original.joined_at, undefined, locale)}
          </span>
        ),
      }),
      createColumn<UserMembership>({
        accessorKey: "status",
        labelKey: "users.memberships.columns.status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusChip
            label={t(`organizations.status.${row.original.status}`)}
            tone={organizationStatusTone(row.original.status)}
          />
        ),
      }),
    ] as ColumnDef<UserMembership, unknown>[];

    if (!canWrite) return base;

    base.push(
      createColumn<UserMembership>({
        id: "actions",
        labelKey: "users.memberships.columns.actions",
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) => {
          const membership = row.original;
          const organizationUuid = membership.organization.uuid;
          const organizationName = membership.organization.name;
          const nextRole = membership.role === "owner" ? "staff" : "owner";
          const actions: EntityRowAction[] = [
            {
              id: "role",
              label:
                nextRole === "owner"
                  ? t("organizations.members.actions.make_owner")
                  : t("organizations.members.actions.make_staff"),
              icon: nextRole === "owner" ? ShieldCheck : UserRound,
              permission: permissions.organizations.write,
              onSelect: async () => {
                const confirmed = await confirm({
                  title: t("organizations.members.role_title"),
                  description: t("users.memberships.role_description", {
                    name: userName,
                    organization: organizationName,
                    role: t(`organizations.roles.${nextRole}`),
                  }),
                });
                if (!confirmed) return;
                await changeRole
                  .mutateAsync({
                    uuid: organizationUuid,
                    userUuid,
                    role: nextRole,
                  })
                  .catch(() => undefined);
                void invalidate(userUuid);
              },
            },
            {
              id: "remove",
              label: t("organizations.members.actions.remove"),
              icon: Trash2,
              permission: permissions.organizations.write,
              variant: "destructive",
              onSelect: async () => {
                const confirmed = await confirmDelete({
                  title: t("organizations.members.remove_title"),
                  description: t("users.memberships.remove_description", {
                    name: userName,
                    organization: organizationName,
                  }),
                  confirmLabel: t("organizations.members.actions.remove"),
                });
                if (!confirmed) return;
                await removeMember
                  .mutateAsync({ uuid: organizationUuid, userUuid })
                  .catch(() => undefined);
                void invalidate(userUuid);
              },
            },
          ];
          return <EntityRowActions actions={actions} />;
        },
      }),
    );
    return base;
  }, [
    canWrite,
    changeRole,
    confirm,
    confirmDelete,
    invalidate,
    locale,
    removeMember,
    t,
    userName,
    userUuid,
  ]);

  const limit = listState.params.limit || 20;
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / limit));

  return (
    <EntitySectionCard
      title={t("users.tabs.organizations")}
      badge={query.data?.total}
      action={
        canWrite ? (
          <PermissionGuard permission={permissions.organizations.write}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
            >
              <Building2 className="size-4" />
              {t("users.memberships.add")}
            </Button>
          </PermissionGuard>
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.organization.uuid}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        emptyTitle={t("users.memberships.empty_title")}
        emptyDescription={t("users.memberships.empty_description")}
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
      <UserAddMembershipDialog
        userUuid={userUuid}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </EntitySectionCard>
  );
}
