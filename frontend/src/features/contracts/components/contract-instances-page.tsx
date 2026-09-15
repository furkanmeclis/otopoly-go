"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { FileStack } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { createColumn } from "@/components/tables";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { columnTextValue } from "@/features/catalog/lib/column-filters";
import {
  useContractInstances,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import type { ContractInstance } from "@/features/contracts/services/contracts.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const STATUS_TABS = ["pending", "executed", "voided", "all"] as const;

function statusTone(status: string) {
  switch (status) {
    case "executed":
      return "success" as const;
    case "pending":
    case "pending_signatures":
      return "warning" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function ContractInstancesPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead } = useTenantContractsAccess(slug);
  const [statusTab, setStatusTab] =
    useState<(typeof STATUS_TABS)[number]>("pending");
  const listState = useServerListState({
    initialSort: "created_at",
    initialPageSize: 20,
  });
  const listParams = useMemo(() => {
    const titleQ = columnTextValue(listState.columnFilters, "title");
    return {
      ...listState.params,
      q: listState.params.q?.trim() || titleQ,
      status: statusTab === "all" ? undefined : statusTab,
    };
  }, [listState.columnFilters, listState.params, statusTab]);
  const listQuery = useContractInstances(listParams, { enabled: canRead });

  const columns = useMemo<ColumnDef<ContractInstance>[]>(
    () => [
      createColumn<ContractInstance>({
        accessorKey: "number_label",
        labelKey: "contracts.fields.number",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-primary font-mono text-sm font-semibold">
            {row.original.number_label || `SZL-${row.original.number}`}
          </span>
        ),
      }),
      createColumn<ContractInstance>({
        accessorKey: "title",
        labelKey: "contracts.fields.title",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.original.title}</span>
            <span className="text-muted-foreground text-xs">
              {row.original.subject_type}
            </span>
          </div>
        ),
      }),
      createColumn<ContractInstance>({
        accessorKey: "status",
        labelKey: "contracts.fields.status",
        cell: ({ row }) => (
          <StatusChip
            label={
              t(`contracts.instances.status.${row.original.status}`) !==
              `contracts.instances.status.${row.original.status}`
                ? t(`contracts.instances.status.${row.original.status}`)
                : row.original.status
            }
            tone={statusTone(row.original.status)}
          />
        ),
      }),
      createColumn<ContractInstance>({
        accessorKey: "created_at",
        labelKey: "contracts.fields.created_at",
        cell: ({ row }) =>
          datetime(row.original.created_at, "dd.MM.yyyy HH:mm", locale),
      }),
    ],
    [locale, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("contracts.templates.forbidden")}
      />
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / (listParams.limit || 20)),
  );

  return (
    <EntityPage
      title={t("contracts.instances.title")}
      description={t("contracts.instances.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("contracts.instances.title") },
      ]}
      actions={
        <EntityActions>
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href={routes.tenant.contracts.templates(slug)}>
              <FileStack className="size-4" />
              {t("contracts.templates.title")}
            </Link>
          </Button>
        </EntityActions>
      }
    >
      <Tabs
        value={statusTab}
        onValueChange={(value) =>
          setStatusTab(value as (typeof STATUS_TABS)[number])
        }
        className="mb-4"
      >
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`contracts.instances.filter.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.tenant.contracts.instanceDetail(slug, row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("contracts.instances.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("contracts.instances.empty_title")}
        emptyDescription={t("contracts.instances.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: `tenant-contract-instances-${slug}`,
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
