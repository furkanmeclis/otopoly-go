"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CarFront } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { BrandMark } from "@/components/common/brand-mark";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PermissionGuard } from "@/components/common/permission-guard";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { CatalogLocalTable } from "@/features/vehicle-catalog/components/catalog-local-table";
import { useCatalogBreadcrumbs } from "@/features/vehicle-catalog/components/catalog-tabs";
import { TypeModelAssign } from "@/features/vehicle-catalog/components/type-model-assign";
import {
  CATALOG_FUELS,
  CATALOG_TRANSMISSIONS,
  formatTRY,
  formatYears,
} from "@/features/vehicle-catalog/constants";
import {
  useCatalogType,
  usePatchType,
} from "@/features/vehicle-catalog/hooks/use-catalog";
import type { CatalogTypeDetail } from "@/features/vehicle-catalog/services/catalog.service";

type Valuation = CatalogTypeDetail["valuations"][number];
import { useLocale } from "@/providers/locale-provider";

const NONE = "__none__";

function SuggestionSelect({
  type,
  field,
}: {
  type: CatalogTypeDetail;
  field: "suggested_fuel" | "suggested_transmission";
}) {
  const { t } = useLocale();
  const patch = usePatchType();
  const values =
    field === "suggested_fuel" ? CATALOG_FUELS : CATALOG_TRANSMISSIONS;
  const prefix =
    field === "suggested_fuel"
      ? "vehicle_catalog.fuel"
      : "vehicle_catalog.transmission";
  const current = type[field];
  const label = current ? t(`${prefix}.${current}`) : "—";

  return (
    <PermissionGuard
      permission={permissions.vehicleBrands.write}
      fallback={label}
    >
      <Select
        value={current ?? NONE}
        disabled={patch.isPending}
        onValueChange={(value) =>
          patch.mutate({
            uuid: type.uuid,
            body: { [field]: value === NONE ? null : value },
          })
        }
      >
        <SelectTrigger size="sm" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            {t("vehicle_catalog.types.unknown")}
          </SelectItem>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {t(`${prefix}.${v}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PermissionGuard>
  );
}

export function CatalogTypeDetailPage({ uuid }: { uuid: string }) {
  const { t, locale } = useLocale();
  const query = useCatalogType(uuid);
  const type = query.data;
  const breadcrumbs = useCatalogBreadcrumbs(
    type?.raw_name ?? t("vehicle_catalog.tabs.types"),
  );

  const valuationColumns = useMemo(
    () =>
      [
        createColumn<Valuation>({
          accessorKey: "model_year",
          labelKey: "vehicle_catalog.columns.year",
          enableSorting: true,
          gridPrimary: true,
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.model_year}</span>
          ),
        }),
        createColumn<Valuation>({
          accessorKey: "value",
          labelKey: "vehicle_catalog.columns.kasko_value",
          enableSorting: true,
          gridSecondary: true,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatTRY(row.original.value, locale)}
            </span>
          ),
        }),
      ] as ColumnDef<Valuation, unknown>[],
    [locale],
  );
  const historyColumns = useMemo(
    () =>
      [
        createColumn<Valuation>({
          accessorKey: "period",
          labelKey: "vehicle_catalog.columns.period",
          enableSorting: true,
          gridPrimary: true,
        }),
        ...valuationColumns,
      ] as ColumnDef<Valuation, unknown>[],
    [valuationColumns],
  );
  const periods = useMemo(
    () => new Set((type?.history ?? []).map((v) => v.period)).size,
    [type?.history],
  );

  return (
    <EntityPage
      title={type?.raw_name ?? t("vehicle_catalog.types.detail_title")}
      description={t("vehicle_catalog.types.detail_description")}
      permission={permissions.vehicleBrands.read}
      forbiddenFallback={
        <ErrorState
          title={t("common.error_forbidden")}
          description={t("vehicle_catalog.forbidden")}
        />
      }
      breadcrumbs={[
        ...breadcrumbs.slice(0, 2),
        {
          label: t("vehicle_catalog.tabs.types"),
          href: routes.platform.vehicleCatalog.types,
        },
        breadcrumbs[2],
      ]}
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("vehicle_catalog.types.not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {type ? (
        <div className="space-y-6">
          <EntityHeader
            title={type.raw_name}
            subtitle={`${type.brand.display_name} · ${type.brand_tsb_name} · ${type.brand.tsb_code ?? ""}/${type.tsb_type_code}`}
            badges={
              <StatusChip
                label={t(`vehicle_catalog.active.${String(type.is_active)}`)}
                tone={type.is_active ? "success" : "default"}
              />
            }
            leading={
              type.display_brand.logo_url ? (
                <BrandMark
                  name={type.display_brand.name}
                  logoUrl={type.display_brand.logo_url}
                  size="lg"
                />
              ) : (
                <div className="bg-muted flex size-12 items-center justify-center rounded-lg">
                  <CarFront className="text-muted-foreground size-6" />
                </div>
              )
            }
          />

          <EntitySectionCard title={t("vehicle_catalog.types.section_details")}>
            <EntityDetail
              sections={[
                {
                  id: "details",
                  fields: [
                    {
                      key: "brand",
                      label: t("vehicle_catalog.columns.brand"),
                      value: (
                        <Link
                          className="hover:underline"
                          href={`${routes.platform.vehicleCatalog.types}?brand=${type.brand.uuid}`}
                        >
                          {type.brand.display_name}
                        </Link>
                      ),
                    },
                    {
                      key: "model",
                      label: t("vehicle_catalog.columns.model"),
                      value: <TypeModelAssign type={type} />,
                    },
                    {
                      key: "years",
                      label: t("vehicle_catalog.columns.years"),
                      value: formatYears(type.years),
                    },
                    {
                      key: "code",
                      label: t("vehicle_catalog.columns.tsb_type_code"),
                      value: (
                        <code className="text-xs">{type.tsb_type_code}</code>
                      ),
                    },
                    {
                      key: "fuel",
                      label: t("vehicle_catalog.columns.fuel"),
                      value: (
                        <SuggestionSelect type={type} field="suggested_fuel" />
                      ),
                    },
                    {
                      key: "transmission",
                      label: t("vehicle_catalog.columns.transmission"),
                      value: (
                        <SuggestionSelect
                          type={type}
                          field="suggested_transmission"
                        />
                      ),
                    },
                    {
                      key: "first_seen",
                      label: t("vehicle_catalog.columns.first_seen_period"),
                      value: type.first_seen_period,
                    },
                    {
                      key: "last_seen",
                      label: t("vehicle_catalog.columns.last_seen_period"),
                      value: type.last_seen_period,
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          <EntitySectionCard
            title={t("vehicle_catalog.types.section_values", {
              period: type.latest_period || "—",
            })}
            badge={type.valuations.length}
          >
            <CatalogLocalTable
              columns={valuationColumns}
              data={type.valuations}
              getRowId={(v) => String(v.model_year)}
              emptyTitle={t("vehicle_catalog.types.no_values")}
              emptyDescription={t("vehicle_catalog.types.no_values_hint")}
              pageSize={20}
            />
          </EntitySectionCard>

          {periods > 1 ? (
            <EntitySectionCard
              title={t("vehicle_catalog.types.section_history")}
              badge={periods}
              collapsible
              defaultOpen={false}
            >
              <CatalogLocalTable
                columns={historyColumns}
                data={type.history}
                getRowId={(v) => `${v.period}-${v.model_year}`}
                pageSize={20}
              />
            </EntitySectionCard>
          ) : null}
        </div>
      ) : null}
    </EntityPage>
  );
}
