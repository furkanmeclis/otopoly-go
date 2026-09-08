"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarPlus, Car, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityCreateButton,
  EntityHeader,
  EntityPage,
  EntityRowActions,
  EntitySectionCard,
  EntityTable,
  type EntityRowAction,
} from "@/components/entity";
import { AppForm, AppInput, AppSwitch } from "@/components/forms";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
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
import { apiConfig } from "@/config/api";
import { routes } from "@/config/routes";
import { permissions } from "@/config/permissions";
import {
  useVehicleBrand,
  useVehicleBrandMutations,
} from "@/features/vehicle-brands/hooks/use-vehicle-brands";
import type { VehicleModel } from "@/features/vehicle-brands/services/vehicle-brands.service";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

function sortedYears(years: number[]) {
  return [...years].sort((a, b) => a - b);
}

function isContiguous(years: number[]) {
  if (years.length < 2) return true;
  return years.every(
    (year, index) => index === 0 || year === years[index - 1] + 1,
  );
}

export function VehicleBrandDetailPage({ uuid }: { uuid: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { hasPermission } = usePermission();
  const canWrite = hasPermission(permissions.vehicleBrands.write);
  const query = useVehicleBrand(uuid);
  const mutations = useVehicleBrandMutations();
  const logoInput = useRef<HTMLInputElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [yearModel, setYearModel] = useState<VehicleModel | null>(null);

  const brand = query.data;
  const models = brand?.models ?? [];
  const activeYearModel = yearModel
    ? (models.find((model) => model.uuid === yearModel.uuid) ?? yearModel)
    : null;
  const logoSrc = brand?.logo_url
    ? `${apiConfig.baseUrl.replace(/\/$/, "")}${brand.logo_url}`
    : null;

  const columns = useMemo<ColumnDef<VehicleModel>[]>(() => {
    const base: ColumnDef<VehicleModel>[] = [
      createColumn<VehicleModel>({
        accessorKey: "name",
        labelKey: "vehicle_brands.detail.model_name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
      }),
      createColumn<VehicleModel>({
        id: "year_count",
        labelKey: "vehicle_brands.detail.year_count",
        accessorFn: (row) => row.years?.length ?? 0,
        enableSorting: true,
        cell: ({ row }) => row.original.years?.length ?? 0,
      }),
      createColumn<VehicleModel>({
        id: "years",
        labelKey: "vehicle_brands.detail.year_range",
        accessorFn: (row) => sortedYears(row.years ?? []).join(" "),
        filterVariant: "text",
        cell: ({ row }) => <YearRange years={row.original.years ?? []} />,
      }),
    ];

    if (!canWrite) return base;

    base.push({
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const model = row.original;
        const actions: EntityRowAction[] = [
          {
            id: "add-year",
            label: t("vehicle_brands.detail.add_year"),
            icon: CalendarPlus,
            onSelect: () => setYearModel(model),
          },
          {
            id: "delete",
            label: t("vehicle_brands.detail.remove_model"),
            icon: Trash2,
            variant: "destructive",
            onSelect: async () => {
              const confirmed = await confirmDelete({
                title: t("vehicle_brands.detail.remove_model"),
                description: t("vehicle_brands.detail.delete_model_confirm"),
              });
              if (!confirmed) return;
              await mutations.deleteModel.mutateAsync(model.uuid);
            },
          },
        ];
        return <EntityRowActions actions={actions} />;
      },
    });

    return base;
  }, [canWrite, confirmDelete, mutations.deleteModel, t]);

  if (!hasPermission(permissions.vehicleBrands.read)) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("vehicle_brands.forbidden")}
      />
    );
  }

  return (
    <EntityPage
      title={brand?.name ?? t("vehicle_brands.title")}
      description={t("vehicle_brands.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.platform.home },
        {
          label: t("vehicle_brands.title"),
          href: routes.platform.vehicleBrands.root,
        },
        { label: brand?.name ?? "…" },
      ]}
      actions={
        canWrite && brand ? (
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
              onClick={() => logoInput.current?.click()}
            >
              {t("vehicle_brands.detail.upload_logo")}
            </Button>
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void mutations.uploadLogo.mutateAsync({ uuid, file });
              }}
            />
            <EntityCreateButton
              onClick={() => setModelOpen(true)}
              label={t("vehicle_brands.detail.add_model")}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                const confirmed = await confirmDelete({
                  title: t("vehicle_brands.detail.delete"),
                  description: t("vehicle_brands.detail.delete_confirm"),
                });
                if (!confirmed) return;
                await mutations.remove.mutateAsync(uuid);
                router.push(routes.platform.vehicleBrands.root);
              }}
            >
              {t("vehicle_brands.detail.delete")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("vehicle_brands.error_description")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {brand ? (
        <div className="space-y-6">
          <EntityHeader
            title={brand.name}
            subtitle={`${models.length} ${t("vehicle_brands.model_count").toLocaleLowerCase()}`}
            badges={
              <StatusChip
                label={
                  brand.is_active ? t("common.active") : t("common.passive")
                }
                tone={brand.is_active ? "success" : "default"}
              />
            }
            leading={
              logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt=""
                  className="h-12 w-auto max-w-[160px] object-contain"
                />
              ) : (
                <div className="bg-muted flex size-12 items-center justify-center rounded-lg">
                  <Car className="text-muted-foreground size-5" />
                </div>
              )
            }
          />

          <EntitySectionCard
            title={t("vehicle_brands.detail.models")}
            badge={models.length}
          >
            <EntityTable
              columns={columns}
              data={models}
              getRowId={(row) => row.uuid}
              isLoading={query.isFetching && !models.length}
              emptyTitle={t("vehicle_brands.detail.models_empty")}
              emptyDescription={t(
                "vehicle_brands.detail.models_empty_description",
              )}
              features={{
                persistKey: `platform-vehicle-brand-models-${uuid}`,
                columnFilters: true,
              }}
            />
          </EntitySectionCard>
        </div>
      ) : null}

      <BrandEditDialog
        brand={editing && brand ? brand : null}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      />
      <ModelDialog
        open={modelOpen}
        onOpenChange={setModelOpen}
        onSubmit={async (name) => {
          await mutations.createModel.mutateAsync({ brandUuid: uuid, name });
          setModelOpen(false);
        }}
      />
      <YearDialog
        model={activeYearModel}
        onOpenChange={(open) => {
          if (!open) setYearModel(null);
        }}
        onSubmit={async (year) => {
          if (!activeYearModel) return;
          await mutations.addYear.mutateAsync({
            modelUuid: activeYearModel.uuid,
            year,
          });
        }}
        onRemove={async (year) => {
          if (!activeYearModel) return;
          await mutations.deleteYear.mutateAsync({
            modelUuid: activeYearModel.uuid,
            year,
          });
        }}
      />
    </EntityPage>
  );
}

function BrandEditDialog({
  brand,
  onOpenChange,
}: {
  brand: { uuid: string; name: string; is_active: boolean } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { update } = useVehicleBrandMutations();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        is_active: z.boolean(),
      }),
    [t],
  );

  return (
    <Dialog open={Boolean(brand)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("vehicle_brands.dialog.edit_title")}</DialogTitle>
          <DialogDescription>
            {t("vehicle_brands.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        {brand ? (
          <AppForm
            key={brand.uuid}
            schema={schema}
            defaultValues={{ name: brand.name, is_active: brand.is_active }}
            onSubmit={async (values) => {
              await update.mutateAsync({ uuid: brand.uuid, body: values });
              onOpenChange(false);
            }}
          >
            <FieldGroup className="gap-4">
              <AppInput
                name="name"
                label={t("vehicle_brands.fields.name")}
                placeholder={t("vehicle_brands.dialog.name_placeholder")}
                required
              />
              <AppSwitch
                name="is_active"
                label={t("vehicle_brands.fields.active")}
              />
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </AppForm>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function YearRange({ years }: { years: number[] }) {
  const sorted = sortedYears(years);
  if (!sorted.length) return <span className="text-muted-foreground">—</span>;

  if (sorted.length <= 4 && !isContiguous(sorted)) {
    return (
      <div className="flex flex-wrap gap-1">
        {sorted.map((year) => (
          <Badge key={year} variant="secondary">
            {year}
          </Badge>
        ))}
      </div>
    );
  }

  const label =
    sorted.length === 1
      ? String(sorted[0])
      : `${sorted[0]}–${sorted[sorted.length - 1]}`;

  return <span className="text-sm tabular-nums">{label}</span>;
}

function ModelDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const schema = useMemo(
    () => z.object({ name: z.string().min(1, t("form.required")) }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("vehicle_brands.detail.add_model")}</DialogTitle>
          <DialogDescription>
            {t("vehicle_brands.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "model-open" : "model-closed"}
          schema={schema}
          defaultValues={{ name: "" }}
          onSubmit={async (values) => onSubmit(values.name)}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="name"
              label={t("vehicle_brands.detail.model_name")}
              placeholder={t("vehicle_brands.detail.model_placeholder")}
              required
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function YearDialog({
  model,
  onOpenChange,
  onSubmit,
  onRemove,
}: {
  model: VehicleModel | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (year: number) => Promise<void>;
  onRemove: (year: number) => Promise<void>;
}) {
  const { t } = useLocale();
  const years = sortedYears(model?.years ?? []);
  const schema = useMemo(
    () =>
      z.object({
        year: z.coerce.number().int().min(1900).max(2100),
      }),
    [],
  );

  return (
    <Dialog open={Boolean(model)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("vehicle_brands.detail.add_year_title")}</DialogTitle>
          <DialogDescription>
            {model?.name} — {t("vehicle_brands.detail.add_year_description")}
          </DialogDescription>
        </DialogHeader>
        {years.length ? (
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {years.map((year) => (
              <Badge key={year} variant="secondary" className="gap-1 pr-1">
                {year}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground rounded-sm px-0.5"
                  aria-label={t("vehicle_brands.detail.remove_year")}
                  onClick={() => void onRemove(year)}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <AppForm
          key={model?.uuid}
          schema={schema}
          defaultValues={{ year: new Date().getFullYear() }}
          onSubmit={async (values) => onSubmit(values.year)}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="year"
              label={t("vehicle_brands.detail.years")}
              type="number"
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
