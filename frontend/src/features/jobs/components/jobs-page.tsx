"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ShoppingBag } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import { EntityActions, EntityPage, EntityToolbar } from "@/components/entity";
import {
  AppCombobox,
  AppForm,
  AppSelect,
  AppTextarea,
  type ComboboxOption,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { useCatalogServices } from "@/features/catalog/hooks/use-catalog-queries";
import {
  customerKeys,
  useCustomer,
  useCustomerMutations,
} from "@/features/customers/hooks/use-customers";
import {
  catalogPickerOptions,
  customersService,
} from "@/features/customers/services/customers.service";
import {
  financeToday,
  formatFinanceAmount,
} from "@/features/finance/lib/format";
import { ResourceIOToolbar } from "@/features/io";
import {
  useJobs,
  useJobsMeta,
  useJobsMutations,
  useJobsSummary,
} from "@/features/jobs/hooks/use-jobs";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import type {
  CreateJobInput,
  Job,
  JobStatus,
} from "@/features/jobs/services/jobs.service";
import { DashboardStatCard } from "@/features/platform-overview/components/dashboard-stat-card";
import { QuickSaleDialog } from "@/features/sales/components/quick-sale-dialog";
import { useTenantSalesAccess } from "@/features/sales/hooks/use-tenant-sales-access";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Label } from "@/components/ui/label";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { useQueryClient } from "@tanstack/react-query";

const STATUS_TABS = ["all", "in_progress", "done", "paid"] as const;

function statusTone(status: JobStatus) {
  switch (status) {
    case "in_progress":
      return "warning" as const;
    case "done":
      return "default" as const;
    case "paid":
      return "success" as const;
    case "cancelled":
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function JobsPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantJobsAccess(slug);
  const { canWrite: canWriteSales } = useTenantSalesAccess(slug);
  const mutations = useJobsMutations();

  const [date, setDate] = useState(() => financeToday());
  const [statusTab, setStatusTab] =
    useState<(typeof STATUS_TABS)[number]>("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);

  const listParams = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      sort: "-started_at",
      q: q.trim() || undefined,
      status: statusTab === "all" ? undefined : statusTab,
      date_from: date || undefined,
      date_to: date || undefined,
    }),
    [date, q, statusTab],
  );

  const listQuery = useJobs(listParams);
  const summaryQuery = useJobsSummary(date);
  const metaQuery = useJobsMeta();

  const applySearch = useCallback(() => {
    setQ(searchInput.trim());
  }, [searchInput]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("jobs.forbidden")}
      />
    );
  }

  const summary = summaryQuery.data;
  const currency = listQuery.data?.items?.[0]?.currency ?? "TRY";
  const items = listQuery.data?.items ?? [];

  return (
    <EntityPage
      title={t("jobs.title")}
      description={t("jobs.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("jobs.title") },
      ]}
      actions={
        canWrite || canWriteSales ? (
          <EntityActions>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                {t("jobs.actions.create")}
              </Button>
            ) : null}
            {canWriteSales ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setQuickSaleOpen(true)}
              >
                <ShoppingBag className="size-4" />
                {t("sales.quick.title")}
              </Button>
            ) : null}
          </EntityActions>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DatePicker
          value={date}
          onChange={setDate}
          className="w-[11rem]"
          aria-label={t("jobs.summary_date")}
        />
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applySearch();
            }}
            placeholder={t("jobs.search_placeholder")}
            className="pl-9"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={applySearch}>
          {t("common.search")}
        </Button>
        <ResourceIOToolbar
          resource="tenant.jobs"
          query={{
            q: listParams.q,
            status: listParams.status,
            date_from: listParams.date_from,
            date_to: listParams.date_to,
            sort: listParams.sort,
          }}
          capabilities={metaQuery.data?.capabilities}
          jobsHref={routes.tenant.exports.root(slug)}
          scope="tenant"
        />
        <EntityToolbar
          onRefresh={() => {
            void listQuery.refetch();
            void summaryQuery.refetch();
          }}
          refreshDisabled={listQuery.isFetching || summaryQuery.isFetching}
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <DashboardStatCard
          label={t("jobs.summary.card_total")}
          value={formatFinanceAmount(summary?.card_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("jobs.summary.cari_total")}
          value={formatFinanceAmount(summary?.cari_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("jobs.summary.net_total")}
          value={formatFinanceAmount(summary?.net_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("jobs.summary.paid_total")}
          value={formatFinanceAmount(summary?.paid_total, currency, locale)}
          loading={summaryQuery.isLoading}
        />
        <DashboardStatCard
          label={t("jobs.summary.job_count")}
          value={summary?.job_count ?? 0}
          loading={summaryQuery.isLoading}
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
              {t(`jobs.filter.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {listQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {listQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("jobs.error_description")}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("jobs.empty_title")}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((job) => (
          <JobCard
            key={job.uuid}
            job={job}
            onOpen={() =>
              router.push(routes.tenant.operations.detail(slug, job.uuid))
            }
          />
        ))}
      </div>

      <CreateJobDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={mutations.create.isPending}
        onSubmit={async (body) => {
          const created = await mutations.create.mutateAsync(body);
          setCreateOpen(false);
          router.push(routes.tenant.operations.detail(slug, created.uuid));
        }}
      />
      <QuickSaleDialog
        open={quickSaleOpen}
        onOpenChange={setQuickSaleOpen}
        onSuccess={(created) => {
          router.push(routes.tenant.sales.detail(slug, created.uuid));
        }}
      />
    </EntityPage>
  );
}

function JobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const { t, locale } = useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-visible:ring-ring rounded-xl text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <Card className="hover:border-primary/40 hover:bg-muted/20 h-full shadow-none transition-colors">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base font-semibold tracking-wide">
              {job.plate}
            </CardTitle>
            <p className="text-muted-foreground truncate text-sm">
              {job.vehicle_label || "—"}
            </p>
          </div>
          <StatusChip
            label={t(`jobs.status.${job.status}`)}
            tone={statusTone(job.status)}
          />
        </CardHeader>
        <CardContent className="space-y-1 pt-0 pb-4">
          <p className="truncate text-sm font-medium">{job.customer_name}</p>
          <p className="text-muted-foreground text-xs">
            {job.customer_phone || "—"}
          </p>
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {datetime(job.started_at, "dd.MM.yyyy HH:mm", locale)}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatFinanceAmount(job.total_amount, job.currency, locale)}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

type SelectedLine = {
  service_uuid: string;
  name: string;
  defaultPrice: string;
  unit_price: string;
};

function CreateJobDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onSubmit: (body: CreateJobInput) => Promise<void>;
}) {
  const { t } = useLocale();
  const [customerUuid, setCustomerUuid] = useState("");
  const [customerOptions, setCustomerOptions] = useState<ComboboxOption[]>([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLine[]>([]);
  const [lineError, setLineError] = useState<string | null>(null);

  const customerQuery = useCustomer(customerUuid);
  const servicesQuery = useCatalogServices({
    limit: 100,
    offset: 0,
    is_active: "true",
    sort: "name",
  });
  const vehicles = customerQuery.data?.vehicles ?? [];
  const services = servicesQuery.data?.items ?? [];

  const schema = useMemo(
    () =>
      z.object({
        customer_uuid: z.string().min(1, t("jobs.validation.customer")),
        vehicle_uuid: z.string().min(1, t("jobs.validation.vehicle")),
        notes: z.string().optional(),
      }),
    [t],
  );

  const loadCustomers = useCallback(async (query: string) => {
    const result = await customersService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
    });
    const options = result.items.map((customer): ComboboxOption => ({
      value: customer.uuid,
      label: customer.phone
        ? `${customer.name} · ${customer.phone}`
        : customer.name,
    }));
    setCustomerOptions((prev) => {
      const byValue = new Map(prev.map((opt) => [opt.value, opt]));
      for (const opt of options) byValue.set(opt.value, opt);
      return [...byValue.values()];
    });
    return options;
  }, []);

  const toggleService = (serviceUuid: string) => {
    setLineError(null);
    setSelectedLines((prev) => {
      const existing = prev.find((line) => line.service_uuid === serviceUuid);
      if (existing) {
        return prev.filter((line) => line.service_uuid !== serviceUuid);
      }
      const service = services.find((item) => item.uuid === serviceUuid);
      if (!service) return prev;
      return [
        ...prev,
        {
          service_uuid: service.uuid,
          name: service.name,
          defaultPrice: service.price,
          unit_price: service.price,
        },
      ];
    });
  };

  const updateLinePrice = (serviceUuid: string, unitPrice: string) => {
    setSelectedLines((prev) =>
      prev.map((line) =>
        line.service_uuid === serviceUuid
          ? { ...line, unit_price: unitPrice }
          : line,
      ),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCustomerUuid("");
          setSelectedLines([]);
          setLineError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("jobs.actions.create")}</DialogTitle>
          <DialogDescription>{t("jobs.create.description")}</DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "create-open" : "create-closed"}
          schema={schema}
          defaultValues={{
            customer_uuid: "",
            vehicle_uuid: "",
            notes: "",
          }}
          onSubmit={async (values) => {
            if (selectedLines.length === 0) {
              setLineError(t("jobs.validation.services"));
              return;
            }
            await onSubmit({
              customer_uuid: values.customer_uuid,
              vehicle_uuid: values.vehicle_uuid,
              notes: values.notes?.trim() || undefined,
              lines: selectedLines.map((line) => ({
                service_uuid: line.service_uuid,
                unit_price:
                  line.unit_price && line.unit_price !== line.defaultPrice
                    ? line.unit_price
                    : undefined,
              })),
            });
          }}
        >
          <CreateJobFields
            customerUuid={customerUuid}
            onCustomerChange={setCustomerUuid}
            customerOptions={customerOptions}
            onCustomerOptionsChange={setCustomerOptions}
            loadCustomers={loadCustomers}
            vehicles={vehicles}
            customerLoading={customerQuery.isLoading}
            services={services}
            servicesLoading={servicesQuery.isLoading}
            selectedLines={selectedLines}
            lineError={lineError}
            onToggleService={toggleService}
            onUpdateLinePrice={updateLinePrice}
            pending={pending}
            onCancel={() => onOpenChange(false)}
          />
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function CreateJobFields({
  customerUuid,
  onCustomerChange,
  customerOptions,
  onCustomerOptionsChange,
  loadCustomers,
  vehicles,
  customerLoading,
  services,
  servicesLoading,
  selectedLines,
  lineError,
  onToggleService,
  onUpdateLinePrice,
  pending,
  onCancel,
}: {
  customerUuid: string;
  onCustomerChange: (uuid: string) => void;
  customerOptions: ComboboxOption[];
  onCustomerOptionsChange: (options: ComboboxOption[]) => void;
  loadCustomers: (query: string) => Promise<ComboboxOption[]>;
  vehicles: {
    uuid: string;
    plate: string;
    brand_name: string;
    model_name: string;
  }[];
  customerLoading: boolean;
  services: { uuid: string; name: string; price: string; currency: string }[];
  servicesLoading: boolean;
  selectedLines: SelectedLine[];
  lineError: string | null;
  onToggleService: (serviceUuid: string) => void;
  onUpdateLinePrice: (serviceUuid: string, unitPrice: string) => void;
  pending?: boolean;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const customerMutations = useCustomerMutations();
  const form = useFormContext<{
    customer_uuid: string;
    vehicle_uuid: string;
    notes?: string;
  }>();
  const watchedCustomer = form.watch("customer_uuid");

  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickVehicleOpen, setQuickVehicleOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [quickPlate, setQuickPlate] = useState("");
  const [quickCatalog, setQuickCatalog] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);

  const handleCustomerValueChange = (uuid: string) => {
    if (uuid === customerUuid) return;
    onCustomerChange(uuid);
    form.setValue("vehicle_uuid", "");
    setQuickVehicleOpen(false);
  };

  const loadCatalog = useCallback(async (query: string) => {
    const result = await customersService.searchCatalog(query.trim());
    return catalogPickerOptions(result.items ?? []);
  }, []);

  const selectCustomer = (customer: {
    uuid: string;
    name: string;
    phone?: string;
  }) => {
    const option: ComboboxOption = {
      value: customer.uuid,
      label: customer.phone
        ? `${customer.name} · ${customer.phone}`
        : customer.name,
    };
    onCustomerOptionsChange([
      ...customerOptions.filter((o) => o.value !== option.value),
      option,
    ]);
    form.setValue("customer_uuid", customer.uuid, { shouldValidate: true });
    onCustomerChange(customer.uuid);
    form.setValue("vehicle_uuid", "");
  };

  const handleQuickCustomer = async () => {
    setQuickError(null);
    const name = quickName.trim();
    if (!name) {
      setQuickError(t("jobs.quick.customer_name_required"));
      return;
    }
    try {
      const created = await customerMutations.create.mutateAsync({
        name,
        phone: quickPhone.trim() || undefined,
        kind: "individual",
        is_active: true,
      });
      selectCustomer(created);
      setQuickName("");
      setQuickPhone("");
      setQuickCustomerOpen(false);
      setQuickVehicleOpen(true);
    } catch {
      /* toast from mutation */
    }
  };

  const handleQuickVehicle = async () => {
    setQuickError(null);
    if (!watchedCustomer) {
      setQuickError(t("jobs.validation.customer"));
      return;
    }
    const plate = quickPlate.trim().toUpperCase();
    const catalog = quickCatalog.trim();
    if (!plate || !catalog) {
      setQuickError(t("jobs.quick.vehicle_required"));
      return;
    }
    const [modelUuid, yearText] = catalog.split(":");
    const year = Number(yearText);
    if (!modelUuid || !Number.isFinite(year)) {
      setQuickError(t("jobs.quick.vehicle_required"));
      return;
    }
    try {
      const vehicle = await customerMutations.addVehicle.mutateAsync({
        customerUuid: watchedCustomer,
        body: { plate, model_uuid: modelUuid, year },
      });
      await queryClient.invalidateQueries({
        queryKey: customerKeys.detail(watchedCustomer),
      });
      form.setValue("vehicle_uuid", vehicle.uuid, { shouldValidate: true });
      setQuickPlate("");
      setQuickCatalog("");
      setQuickVehicleOpen(false);
    } catch {
      /* toast from mutation */
    }
  };

  return (
    <>
      <FieldGroup className="gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">{t("jobs.customer")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => {
                setQuickError(null);
                setQuickCustomerOpen((open) => !open);
                setQuickVehicleOpen(false);
              }}
            >
              <Plus className="size-3.5" />
              {t("jobs.quick.add_customer")}
            </Button>
          </div>
          <AppCombobox
            name="customer_uuid"
            loadOptions={loadCustomers}
            options={customerOptions}
            placeholder={t("jobs.pick_customer")}
            searchPlaceholder={t("jobs.search_customer")}
            emptyText={t("jobs.no_customers")}
            onValueChange={handleCustomerValueChange}
          />
          {quickCustomerOpen ? (
            <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
              <Input
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder={t("jobs.quick.name_placeholder")}
                autoFocus
              />
              <Input
                value={quickPhone}
                onChange={(e) => setQuickPhone(e.target.value)}
                placeholder={t("jobs.quick.phone_placeholder")}
                inputMode="tel"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuickCustomerOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={customerMutations.create.isPending}
                  onClick={() => void handleQuickCustomer()}
                >
                  {customerMutations.create.isPending
                    ? t("common.saving")
                    : t("jobs.quick.save_customer")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">{t("jobs.vehicle")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={!watchedCustomer}
              onClick={() => {
                setQuickError(null);
                setQuickVehicleOpen((open) => !open);
                setQuickCustomerOpen(false);
              }}
            >
              <Plus className="size-3.5" />
              {t("jobs.quick.add_vehicle")}
            </Button>
          </div>
          <AppSelect
            name="vehicle_uuid"
            placeholder={t("jobs.pick_vehicle")}
            disabled={!watchedCustomer || customerLoading}
            options={vehicles.map((vehicle) => ({
              value: vehicle.uuid,
              label: `${vehicle.plate} · ${vehicle.brand_name} ${vehicle.model_name}`,
            }))}
          />
          {quickVehicleOpen && watchedCustomer ? (
            <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
              <Input
                value={quickPlate}
                onChange={(e) => setQuickPlate(e.target.value.toUpperCase())}
                placeholder={t("jobs.quick.plate_placeholder")}
                autoFocus
              />
              <AsyncCombobox
                value={quickCatalog}
                onValueChange={setQuickCatalog}
                loadOptions={loadCatalog}
                placeholder={t("jobs.quick.catalog_placeholder")}
                searchPlaceholder={t("jobs.quick.catalog_search")}
                emptyText={t("jobs.quick.catalog_empty")}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuickVehicleOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={customerMutations.addVehicle.isPending}
                  onClick={() => void handleQuickVehicle()}
                >
                  {customerMutations.addVehicle.isPending
                    ? t("common.saving")
                    : t("jobs.quick.save_vehicle")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {quickError ? (
          <p className="text-destructive text-sm">{quickError}</p>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("jobs.services")}</p>
          {servicesLoading ? (
            <p className="text-muted-foreground text-sm">
              {t("common.loading")}
            </p>
          ) : (
            <ul className="divide-border max-h-48 divide-y overflow-y-auto rounded-md border">
              {services.map((service) => {
                const selected = selectedLines.find(
                  (line) => line.service_uuid === service.uuid,
                );
                return (
                  <li
                    key={service.uuid}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
                  >
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <Checkbox
                        checked={Boolean(selected)}
                        onCheckedChange={() => onToggleService(service.uuid)}
                      />
                      <span className="truncate">{service.name}</span>
                    </label>
                    {selected ? (
                      <Input
                        value={selected.unit_price}
                        onChange={(event) =>
                          onUpdateLinePrice(service.uuid, event.target.value)
                        }
                        className="h-8 w-28 tabular-nums"
                        aria-label={t("jobs.unit_price")}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {service.price} {service.currency}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {lineError ? (
            <p className="text-destructive text-sm">{lineError}</p>
          ) : null}
        </div>
        <AppTextarea name="notes" label={t("jobs.notes")} />
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
