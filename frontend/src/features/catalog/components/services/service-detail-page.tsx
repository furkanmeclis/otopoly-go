"use client";

// TODO(catalog): Service add-ons, staff assignment, calendar duration rules, and net/gross price breakdown.

import { useState } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityDetail,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { ServiceDialog } from "@/features/catalog/components/services/service-dialog";
import { useCatalogServiceDetail } from "@/features/catalog/hooks/use-catalog-queries";
import { useTenantCatalogAccess } from "@/features/catalog/hooks/use-tenant-catalog-access";
import { datetime } from "@/lib/utils/format";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useLocale } from "@/providers/locale-provider";

export function ServiceDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { canWrite } = useTenantCatalogAccess(slug);
  const query = useCatalogServiceDetail(uuid);
  const service = query.data;
  const [editing, setEditing] = useState(false);

  const title = service?.name ?? t("catalog.detail.service_title");

  return (
    <EntityPage
      title={title}
      description={t("catalog.detail.service_description")}
      breadcrumbs={[
        {
          label: t("layout.breadcrumb_home"),
          href: routes.tenant.home(slug),
        },
        {
          label: t("catalog.services.title"),
          href: routes.tenant.catalog.services.root(slug),
        },
        { label: title },
      ]}
      actions={
        canWrite && service ? (
          <Button type="button" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("catalog.detail.service_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {service ? (
        <div className="space-y-6">
          <StatusChip
            label={service.is_active ? t("common.active") : t("common.passive")}
            tone={service.is_active ? "success" : "default"}
          />

          <EntitySectionCard title={t("catalog.detail.service_info")}>
            <EntityDetail
              sections={[
                {
                  id: "identity",
                  fields: [
                    {
                      key: "name",
                      label: t("catalog.services.name"),
                      value: service.name,
                    },
                    {
                      key: "category",
                      label: t("catalog.services.category"),
                      value: service.category_name || "—",
                    },
                    {
                      key: "code",
                      label: t("catalog.services.code"),
                      value: service.code || "—",
                    },
                    {
                      key: "duration",
                      label: t("catalog.services.duration"),
                      value: t("catalog.services.duration_value", {
                        minutes: service.duration_minutes,
                      }),
                    },
                  ],
                },
                {
                  id: "pricing",
                  fields: [
                    {
                      key: "price",
                      label: t("catalog.services.price"),
                      value: formatFinanceAmount(
                        service.price,
                        service.currency,
                        locale,
                      ),
                    },
                    {
                      key: "vat",
                      label: t("catalog.services.vat_rate"),
                      value: t("catalog.services.vat_suffix", {
                        rate: service.vat_rate,
                      }),
                    },
                    {
                      key: "currency",
                      label: t("catalog.services.currency"),
                      value: service.currency,
                    },
                    {
                      key: "created",
                      label: t("catalog.detail.created_at"),
                      value: datetime(
                        service.created_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                    {
                      key: "updated",
                      label: t("catalog.detail.updated_at"),
                      value: datetime(
                        service.updated_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                  ],
                },
              ]}
            />
            {service.description ? (
              <p className="text-muted-foreground mt-4 text-sm">
                {service.description}
              </p>
            ) : null}
          </EntitySectionCard>
        </div>
      ) : null}

      <ServiceDialog
        open={editing}
        onOpenChange={setEditing}
        service={service}
      />
    </EntityPage>
  );
}
