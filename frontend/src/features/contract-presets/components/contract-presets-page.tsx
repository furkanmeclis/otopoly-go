"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityCreateButton,
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import { useContractPresets } from "@/features/contract-presets/hooks/use-contract-presets";
import type { ContractPreset } from "@/features/contract-presets/services/contract-presets.service";
import { routes } from "@/config/routes";
import { permissions } from "@/config/permissions";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export function ContractPresetsPage() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { hasPermission } = usePermission();
  const canWrite = hasPermission(permissions.contractPresets.write);
  const listState = useServerListState({
    initialSort: "title",
    initialPageSize: 20,
  });
  const listParams = useMemo(() => {
    const titleQ = columnTextValue(listState.columnFilters, "title");
    return {
      ...listState.params,
      q: listState.params.q?.trim() || titleQ,
      is_active: columnSelectValue(listState.columnFilters, "is_active"),
    };
  }, [listState.columnFilters, listState.params]);
  const listQuery = useContractPresets(listParams);

  const columns = useMemo<ColumnDef<ContractPreset>[]>(
    () => [
      createColumn<ContractPreset>({
        accessorKey: "title",
        labelKey: "contracts.fields.title",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.original.title}</span>
            {row.original.category ? (
              <span className="text-muted-foreground text-xs">
                {row.original.category}
              </span>
            ) : null}
          </div>
        ),
      }),
      createColumn<ContractPreset>({
        id: "is_active",
        labelKey: "common.status",
        accessorFn: (row) => (row.is_active ? "true" : "false"),
        filterVariant: "select",
        filterOptions: [
          { value: "true", labelKey: "common.active", label: "true" },
          { value: "false", labelKey: "common.passive", label: "false" },
        ],
        cell: ({ row }) => (
          <StatusChip
            label={
              row.original.is_active ? t("common.active") : t("common.passive")
            }
            tone={row.original.is_active ? "success" : "default"}
          />
        ),
      }),
      createColumn<ContractPreset>({
        accessorKey: "created_at",
        labelKey: "contracts.fields.created_at",
        cell: ({ row }) =>
          datetime(row.original.created_at, "dd.MM.yyyy", locale),
      }),
    ],
    [locale, t],
  );

  if (!hasPermission(permissions.contractPresets.read)) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("contracts.presets.forbidden")}
      />
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / (listParams.limit || 20)),
  );

  return (
    <EntityPage
      title={t("contracts.presets.title")}
      description={t("contracts.presets.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.platform.home },
        { label: t("contracts.presets.title") },
      ]}
      actions={
        canWrite ? (
          <EntityActions>
            <EntityCreateButton
              onClick={() => router.push(routes.platform.contractPresets.create)}
              label={t("contracts.presets.new")}
            />
          </EntityActions>
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.platform.contractPresets.detail(row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("contracts.presets.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("contracts.presets.empty_title")}
        emptyDescription={t("contracts.presets.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: "platform-contract-presets",
          columnFilters: true,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />
    </EntityPage>
  );
}
