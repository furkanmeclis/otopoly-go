"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, Trash2, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PermissionGuard } from "@/components/common/permission-guard";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityRowActions,
  EntitySectionCard,
  EntityTable,
  type EntityRowAction,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { OrganizationAddMemberDialog } from "@/features/organizations/components/organization-add-member-dialog";
import {
  useChangeOrganizationMemberRole,
  useRemoveOrganizationMember,
} from "@/features/organizations/hooks/use-organization-mutations";
import type { OrganizationMember } from "@/features/organizations/services/organizations.service";
import { userFullName } from "@/features/users/lib/user-display";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type OrganizationMembersTableProps = {
  organizationUuid: string;
  members: OrganizationMember[];
  isLoading?: boolean;
};

/**
 * Members of an organization for platform admins: list, add, change role
 * (owner / staff) and remove. The last owner cannot be demoted or removed
 * (the API enforces it too). Self-contained so other detail pages can reuse it.
 */
export function OrganizationMembersTable({
  organizationUuid,
  members,
  isLoading,
}: OrganizationMembersTableProps) {
  const { t } = useLocale();
  const { can } = usePermission();
  const { confirm, confirmDelete } = useDialogs();
  const changeRole = useChangeOrganizationMemberRole();
  const removeMember = useRemoveOrganizationMember();
  const [addOpen, setAddOpen] = useState(false);

  const canWrite = can(permissions.organizations.write);
  const ownerCount = members.filter((member) => member.role === "owner").length;

  const columns = useMemo(() => {
    const base = [
      createColumn<OrganizationMember>({
        id: "name",
        accessorFn: (row) => userFullName(row),
        labelKey: "organizations.members.columns.name",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <Link
            href={routes.platform.users.detail(
              row.original.uuid,
              "organizations",
            )}
            className="font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {userFullName(row.original)}
          </Link>
        ),
      }),
      createColumn<OrganizationMember>({
        accessorKey: "email",
        labelKey: "organizations.members.columns.email",
        filterVariant: "text",
        gridSecondary: true,
      }),
      createColumn<OrganizationMember>({
        accessorKey: "role",
        labelKey: "organizations.members.columns.role",
        filterVariant: "faceted",
        filterOptions: (["owner", "staff"] as const).map((value) => ({
          value,
          labelKey: `organizations.roles.${value}`,
          label: value,
        })),
        cell: ({ row }) => (
          <StatusChip
            label={t(`organizations.roles.${row.original.role}`)}
            tone={row.original.role === "owner" ? "success" : "default"}
          />
        ),
      }),
      createColumn<OrganizationMember>({
        accessorKey: "created_at",
        labelKey: "organizations.members.columns.joined_at",
        enableColumnFilter: false,
        cell: ({ row }) =>
          row.original.created_at ? (
            <span className="tabular-nums">
              {datetime(row.original.created_at)}
            </span>
          ) : (
            "—"
          ),
      }),
    ] as ColumnDef<OrganizationMember, unknown>[];

    if (!canWrite) return base;

    base.push(
      createColumn<OrganizationMember>({
        id: "actions",
        labelKey: "organizations.members.columns.actions",
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        enableColumnFilter: false,
        cell: ({ row }) => {
          const member = row.original;
          const isLastOwner = member.role === "owner" && ownerCount <= 1;
          const name = userFullName(member);
          const nextRole = member.role === "owner" ? "staff" : "owner";
          const actions: EntityRowAction[] = [
            {
              id: "role",
              label:
                nextRole === "owner"
                  ? t("organizations.members.actions.make_owner")
                  : isLastOwner
                    ? t("organizations.members.last_owner")
                    : t("organizations.members.actions.make_staff"),
              icon: nextRole === "owner" ? ShieldCheck : UserRound,
              permission: permissions.organizations.write,
              disabled: isLastOwner,
              onSelect: async () => {
                const confirmed = await confirm({
                  title: t("organizations.members.role_title"),
                  description: t("organizations.members.role_description", {
                    name,
                    role: t(`organizations.roles.${nextRole}`),
                  }),
                });
                if (!confirmed) return;
                await changeRole
                  .mutateAsync({
                    uuid: organizationUuid,
                    userUuid: member.uuid,
                    role: nextRole,
                  })
                  .catch(() => undefined);
              },
            },
            {
              id: "remove",
              label: isLastOwner
                ? t("organizations.members.last_owner")
                : t("organizations.members.actions.remove"),
              icon: Trash2,
              permission: permissions.organizations.write,
              variant: "destructive",
              disabled: isLastOwner,
              onSelect: async () => {
                const confirmed = await confirmDelete({
                  title: t("organizations.members.remove_title"),
                  description: t("organizations.members.remove_description", {
                    name,
                  }),
                  confirmLabel: t("organizations.members.actions.remove"),
                });
                if (!confirmed) return;
                await removeMember
                  .mutateAsync({
                    uuid: organizationUuid,
                    userUuid: member.uuid,
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
  }, [
    canWrite,
    changeRole,
    confirm,
    confirmDelete,
    organizationUuid,
    ownerCount,
    removeMember,
    t,
  ]);

  return (
    <EntitySectionCard
      title={t("organizations.detail.members")}
      badge={members.length}
      action={
        <PermissionGuard permission={permissions.organizations.write}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAddOpen(true)}
          >
            <UserPlus className="size-4" />
            {t("organizations.actions.add_member")}
          </Button>
        </PermissionGuard>
      }
    >
      <EntityTable
        columns={columns}
        data={members}
        getRowId={(row) => row.uuid}
        isLoading={isLoading}
        emptyTitle={t("organizations.detail.members_empty")}
        features={{
          persistKey: "platform-organization-members-v1",
          columnFilters: true,
        }}
      />
      <OrganizationAddMemberDialog
        organizationUuid={organizationUuid}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </EntitySectionCard>
  );
}
