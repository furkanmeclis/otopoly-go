"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { FileStack, Plus, Search } from "lucide-react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { columnTextValue } from "@/features/catalog/lib/column-filters";
import {
  useContractInstances,
  useContractMutations,
  useContractTemplates,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import type {
  ContractInstance,
  ContractInstanceStatus,
} from "@/features/contracts/services/contracts.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const STATUS_TABS = ["all", "draft", "pending", "executed", "voided"] as const;

function statusTone(status: string) {
  switch (status) {
    case "draft":
      return "default" as const;
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
  const searchParams = useSearchParams();
  const { canRead, canWrite } = useTenantContractsAccess(slug);

  const [statusTab, setStatusTab] =
    useState<(typeof STATUS_TABS)[number]>("all");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Support ?job_uuid=xxx from URL for automatic subject binding
  const jobUuidFromUrl = searchParams?.get("job_uuid") ?? undefined;

  const listState = useServerListState({
    initialSort: "created_at",
    initialPageSize: 20,
  });

  const listParams = useMemo(() => {
    const titleQ = columnTextValue(listState.columnFilters, "title");
    return {
      ...listState.params,
      q: q.trim() || listState.params.q?.trim() || titleQ || undefined,
      status: statusTab === "all" ? undefined : statusTab,
    };
  }, [listState.columnFilters, listState.params, statusTab, q]);

  const listQuery = useContractInstances(listParams, { enabled: canRead });

  const applySearch = useCallback(() => {
    setQ(searchInput.trim());
  }, [searchInput]);

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
            {row.original.subject_type ? (
              <span className="text-muted-foreground text-xs">
                {row.original.subject_type}
              </span>
            ) : null}
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
                ? t(
                    `contracts.instances.status.${row.original.status as ContractInstanceStatus}`,
                  )
                : row.original.status
            }
            tone={statusTone(row.original.status)}
          />
        ),
      }),
      createColumn<ContractInstance>({
        id: "signers_summary",
        labelKey: "contracts.fields.signers",
        cell: ({ row }) => {
          const signers = row.original.signers ?? [];
          if (signers.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
          const signed = signers.filter((s) => s.status === "signed").length;
          return (
            <span className="text-muted-foreground tabular-nums text-xs">
              {signed}/{signers.length}
            </span>
          );
        },
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
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" />
              {t("contracts.instances.create")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href={routes.tenant.contracts.templates(slug)}>
              <FileStack className="size-4" />
              {t("contracts.templates.title")}
            </Link>
          </Button>
        </EntityActions>
      }
    >
      {/* Search + filter toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            placeholder={t("contracts.instances.search_placeholder")}
            className="pl-9"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={applySearch}>
          {t("common.search")}
        </Button>
        <EntityToolbar
          onRefresh={() => void listQuery.refetch()}
          refreshDisabled={listQuery.isFetching}
        />
      </div>

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
      />

      <CreateInstanceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        slug={slug}
        defaultJobUuid={jobUuidFromUrl}
      />
    </EntityPage>
  );
}

function CreateInstanceDialog({
  open,
  onOpenChange,
  slug,
  defaultJobUuid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  defaultJobUuid?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const mutations = useContractMutations();
  const [templateUuid, setTemplateUuid] = useState("");

  const templatesQuery = useContractTemplates({
    is_active: "true",
    limit: 100,
    offset: 0,
  });

  const handleCreate = async () => {
    if (!templateUuid) return;
    const created = await mutations.createInstance.mutateAsync({
      template_uuid: templateUuid,
      ...(defaultJobUuid
        ? { subject_type: "service_job", subject_uuid: defaultJobUuid }
        : {}),
    });
    onOpenChange(false);
    setTemplateUuid("");
    router.push(routes.tenant.contracts.instanceDetail(slug, created.uuid));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTemplateUuid("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("contracts.instances.create_title")}</DialogTitle>
          <DialogDescription>
            {t("contracts.instances.create_description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("contracts.instances.create_template")}</Label>
          <Select value={templateUuid} onValueChange={setTemplateUuid}>
            <SelectTrigger>
              <SelectValue
                placeholder={t("contracts.instances.create_template")}
              />
            </SelectTrigger>
            <SelectContent>
              {(templatesQuery.data?.items ?? []).map((tpl) => (
                <SelectItem key={tpl.uuid} value={tpl.uuid}>
                  {tpl.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {defaultJobUuid ? (
            <p className="text-muted-foreground text-xs">
              {t("contracts.instances.auto_subject_binding")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!templateUuid || mutations.createInstance.isPending}
            onClick={() => void handleCreate()}
          >
            {mutations.createInstance.isPending
              ? t("common.saving")
              : t("contracts.instances.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
