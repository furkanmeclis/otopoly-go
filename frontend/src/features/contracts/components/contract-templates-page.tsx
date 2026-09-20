"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { Copy } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import { ClonePresetDialog } from "@/features/contracts/components/clone-preset-dialog";
import {
  useContractMutations,
  useContractTemplates,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import type { ContractTemplate } from "@/features/contracts/services/contracts.service";
import {
  CONTRACT_VARIABLES,
  DEFAULT_SIGNER_SLOTS,
} from "@/features/contract-presets/services/contract-presets.service";
import { routes } from "@/config/routes";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function ContractTemplatesPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canManage } = useTenantContractsAccess(slug);
  const mutations = useContractMutations();
  const [cloneOpen, setCloneOpen] = useState(false);
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
  const listQuery = useContractTemplates(listParams);

  const columns = useMemo<ColumnDef<ContractTemplate>[]>(
    () => [
      createColumn<ContractTemplate>({
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
      createColumn<ContractTemplate>({
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
      createColumn<ContractTemplate>({
        accessorKey: "created_at",
        labelKey: "contracts.fields.created_at",
        cell: ({ row }) =>
          datetime(row.original.created_at, "dd.MM.yyyy", locale),
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
      title={t("contracts.templates.title")}
      description={t("contracts.templates.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("contracts.instances.title"),
          href: routes.tenant.contracts.root(slug),
        },
        { label: t("contracts.templates.title") },
      ]}
      actions={
        canManage ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCloneOpen(true)}
            >
              <Copy className="size-4" />
              {t("contracts.templates.clone")}
            </Button>
            <EntityCreateButton
              label={t("contracts.templates.new")}
              onClick={() => {
                if (mutations.createTemplate.isPending) return;
                void mutations.createTemplate
                  .mutateAsync({
                    title: t("contracts.templates.create_title"),
                    content_html: "<p></p>",
                    content_json: {},
                    variables: [...CONTRACT_VARIABLES],
                    signer_slots: DEFAULT_SIGNER_SLOTS,
                    signature_required: true,
                    is_active: true,
                  })
                  .then((created) => {
                    router.push(
                      routes.tenant.contracts.templateDetail(
                        slug,
                        created.uuid,
                      ),
                    );
                  });
              }}
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
          router.push(routes.tenant.contracts.templateDetail(slug, row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("contracts.templates.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("contracts.templates.empty_title")}
        emptyDescription={t("contracts.templates.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: `tenant-contract-templates-${slug}`,
          columnFilters: true,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />
      <ClonePresetDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        onCloned={(uuid) =>
          router.push(routes.tenant.contracts.templateDetail(slug, uuid))
        }
      />
    </EntityPage>
  );
}
