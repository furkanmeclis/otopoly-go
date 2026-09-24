"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  AppCombobox,
  AppForm,
  AppSelect,
  AppTextarea,
  type ComboboxOption,
} from "@/components/forms";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
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
import type { CreateJobInput } from "@/features/jobs/services/jobs.service";
import { useStaffOptions } from "@/features/staff/hooks/use-staff";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useLocale } from "@/providers/locale-provider";

type SelectedLine = {
  service_uuid: string;
  name: string;
  defaultPrice: string;
  unit_price: string;
};

export function CreateJobDialog({
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
        assignee_uuid: z.string().optional(),
        notes: z.string().optional(),
      }),
    [t],
  );

  const staffOptionsQuery = useStaffOptions(open);
  const assigneeOptions = useMemo(
    () =>
      (staffOptionsQuery.data?.items ?? []).map((member) => ({
        value: member.uuid,
        label: member.label,
      })),
    [staffOptionsQuery.data?.items],
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
            assignee_uuid: "",
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
              assignee_uuid: values.assignee_uuid?.trim() || undefined,
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
            assigneeOptions={assigneeOptions}
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
  assigneeOptions,
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
  assigneeOptions: ComboboxOption[];
  pending?: boolean;
  onCancel: () => void;
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const customerMutations = useCustomerMutations();
  const form = useFormContext<{
    customer_uuid: string;
    vehicle_uuid: string;
    assignee_uuid?: string;
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
                        {formatFinanceAmount(
                          service.price,
                          service.currency,
                          locale,
                        )}
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
        <AppSelect
          name="assignee_uuid"
          label={t("jobs.assignee")}
          options={[
            { value: "", label: t("jobs.assignee_none") },
            ...assigneeOptions,
          ]}
          placeholder={t("jobs.pick_assignee")}
        />
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
