"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound } from "lucide-react";
import { z } from "zod";

import {
  EntityCreateButton,
  EntityPage,
  EntityTable,
} from "@/components/entity";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import { AppForm, AppInput } from "@/components/forms";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { routes } from "@/config/routes";
import { useStaff, useStaffMutations } from "@/features/staff/hooks/use-staff";
import { useTenantStaffAccess } from "@/features/staff/hooks/use-tenant-staff-access";
import type { StaffMember } from "@/features/staff/services/staff.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function StaffPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const { canRead, canWrite } = useTenantStaffAccess(slug);
  const listQuery = useStaff();
  const mutations = useStaffMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordMember, setPasswordMember] = useState<StaffMember | null>(
    null,
  );

  const columns = useMemo<ColumnDef<StaffMember>[]>(
    () => [
      createColumn<StaffMember>({
        accessorKey: "name",
        labelKey: "staff.name",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              {row.original.name} {row.original.surname}
            </span>
            <span className="text-muted-foreground text-xs">
              {row.original.email}
            </span>
          </div>
        ),
      }),
      createColumn<StaffMember>({
        accessorKey: "status",
        labelKey: "staff.status",
        cell: ({ row }) => (
          <StatusChip
            label={t(`staff.status.${row.original.status}`)}
            tone={row.original.status === "active" ? "success" : "danger"}
          />
        ),
      }),
      createColumn<StaffMember>({
        accessorKey: "created_at",
        labelKey: "staff.created_at",
        cell: ({ row }) =>
          datetime(row.original.created_at, "dd.MM.yyyy", locale),
      }),
      createColumn<StaffMember>({
        id: "actions",
        labelKey: "common.actions",
        enableSorting: false,
        cell: ({ row }) =>
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutations.patch.isPending}
                onClick={() =>
                  void mutations.patch.mutateAsync({
                    uuid: row.original.uuid,
                    status:
                      row.original.status === "active" ? "inactive" : "active",
                  })
                }
              >
                {row.original.status === "active"
                  ? t("staff.actions.deactivate")
                  : t("staff.actions.activate")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPasswordMember(row.original)}
              >
                <KeyRound className="size-4" />
                {t("staff.actions.reset_password")}
              </Button>
            </div>
          ) : (
            "—"
          ),
      }),
    ],
    [canWrite, locale, mutations.patch, t],
  );

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("staff.validation.name")),
        surname: z.string().min(1, t("staff.validation.surname")),
        email: z.string().email(t("staff.validation.email")),
        password: z.string().min(8, t("staff.validation.password")),
      }),
    [t],
  );

  const passwordSchema = useMemo(
    () =>
      z.object({
        password: z.string().min(8, t("staff.validation.password")),
      }),
    [t],
  );

  if (!canRead) {
    return (
      <EntityPage title={t("staff.title")} description={t("staff.description")}>
        <ErrorState
          title={t("common.error_forbidden")}
          description={t("staff.forbidden")}
        />
      </EntityPage>
    );
  }

  return (
    <EntityPage
      title={t("staff.title")}
      description={t("staff.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("staff.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("staff.actions.create")}
          />
        ) : null
      }
    >
      {listQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {listQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("staff.load_error")}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}
      {!listQuery.isLoading && !listQuery.isError ? (
        <EntityTable
          columns={columns}
          data={listQuery.data?.items ?? []}
          emptyTitle={t("staff.empty")}
        />
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("staff.create.title")}</DialogTitle>
            <DialogDescription>{t("staff.create.description")}</DialogDescription>
          </DialogHeader>
          <AppForm
            schema={schema}
            defaultValues={{
              name: "",
              surname: "",
              email: "",
              password: "",
            }}
            onSubmit={async (values) => {
              await mutations.create.mutateAsync(values);
              setCreateOpen(false);
            }}
          >
            <FieldGroup>
              <AppInput name="name" label={t("staff.name")} />
              <AppInput name="surname" label={t("staff.surname")} />
              <AppInput name="email" label={t("staff.email")} type="email" />
              <AppInput
                name="password"
                label={t("staff.password")}
                type="password"
              />
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={mutations.create.isPending}>
                {t("staff.actions.create")}
              </Button>
            </DialogFooter>
          </AppForm>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(passwordMember)}
        onOpenChange={(open) => {
          if (!open) setPasswordMember(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("staff.reset.title")}</DialogTitle>
            <DialogDescription>
              {passwordMember
                ? `${passwordMember.name} ${passwordMember.surname}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <AppForm
            schema={passwordSchema}
            defaultValues={{ password: "" }}
            onSubmit={async (values) => {
              if (!passwordMember) return;
              await mutations.resetPassword.mutateAsync({
                uuid: passwordMember.uuid,
                password: values.password,
              });
              setPasswordMember(null);
            }}
          >
            <AppInput
              name="password"
              label={t("staff.password")}
              type="password"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPasswordMember(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={mutations.resetPassword.isPending}
              >
                {t("staff.actions.reset_password")}
              </Button>
            </DialogFooter>
          </AppForm>
        </DialogContent>
      </Dialog>
    </EntityPage>
  );
}
