"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { SupplierDialog } from "@/features/suppliers/components/suppliers-page";
import {
  useSupplier,
  useSupplierMutations,
} from "@/features/suppliers/hooks/use-suppliers";
import { useTenantSuppliersAccess } from "@/features/suppliers/hooks/use-tenant-suppliers-access";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function SupplierDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canRead, canWrite } = useTenantSuppliersAccess(slug);
  const query = useSupplier(uuid);
  const mutations = useSupplierMutations();
  const [editing, setEditing] = useState(false);
  const supplier = query.data;
  const title = supplier?.name ?? t("suppliers.title");

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("suppliers.forbidden")}
      />
    );
  }

  return (
    <EntityPage
      title={title}
      description={t("suppliers.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("suppliers.title"),
          href: routes.tenant.suppliers.root(slug),
        },
        { label: title },
      ]}
      actions={
        supplier && canWrite ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
              {t("common.edit")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                const confirmed = await confirmDelete({
                  title: t("suppliers.detail.delete"),
                  description: t("suppliers.detail.delete_confirm"),
                });
                if (!confirmed) return;
                await mutations.remove.mutateAsync(uuid);
                router.push(routes.tenant.suppliers.root(slug));
              }}
            >
              {t("suppliers.detail.delete")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("suppliers.error_description")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {supplier ? (
        <div className="space-y-6">
          <EntityHeader
            title={supplier.name}
            subtitle={supplier.phone || supplier.email || undefined}
            badges={
              <StatusChip
                label={
                  supplier.is_active ? t("common.active") : t("common.passive")
                }
                tone={supplier.is_active ? "success" : "default"}
              />
            }
          />

          <EntitySectionCard title={t("suppliers.detail.info")}>
            <EntityDetail
              sections={[
                {
                  id: "info",
                  fields: [
                    {
                      key: "name",
                      label: t("suppliers.fields.name"),
                      value: supplier.name,
                    },
                    {
                      key: "phone",
                      label: t("suppliers.fields.phone"),
                      value: supplier.phone || "—",
                    },
                    {
                      key: "email",
                      label: t("suppliers.fields.email"),
                      value: supplier.email || "—",
                    },
                    {
                      key: "tax_id",
                      label: t("suppliers.fields.tax_id"),
                      value: supplier.tax_id || "—",
                    },
                    {
                      key: "notes",
                      label: t("suppliers.fields.notes"),
                      value: supplier.notes || "—",
                    },
                    {
                      key: "created",
                      label: t("suppliers.created_at"),
                      value: datetime(
                        supplier.created_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>
        </div>
      ) : null}

      <SupplierDialog
        open={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
        supplier={editing ? supplier : null}
      />
    </EntityPage>
  );
}
