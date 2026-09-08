"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import {
  vehicleBrandsService,
  type VehicleBrandDetail,
} from "@/features/vehicle-brands/services/vehicle-brands.service";
import { useLocale } from "@/providers/locale-provider";

export const vehicleBrandKeys = {
  all: ["platform", "vehicle-brands"] as const,
  list: (params?: unknown) =>
    [...vehicleBrandKeys.all, "list", params] as const,
  detail: (uuid: string) => [...vehicleBrandKeys.all, "detail", uuid] as const,
};

export function useVehicleBrands(
  params?: ServerListParams & { is_active?: string },
) {
  return useQuery({
    queryKey: vehicleBrandKeys.list(params),
    queryFn: () => vehicleBrandsService.list(params),
  });
}

export function useVehicleBrand(uuid: string) {
  return useQuery({
    queryKey: vehicleBrandKeys.detail(uuid),
    queryFn: () => vehicleBrandsService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useVehicleBrandMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: vehicleBrandKeys.all });

  return {
    create: useMutation({
      mutationFn: vehicleBrandsService.create,
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.created"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    update: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: { name?: string; is_active?: boolean };
      }) => vehicleBrandsService.update(uuid, body),
      onSuccess: (data: VehicleBrandDetail) => {
        invalidate();
        queryClient.setQueryData(vehicleBrandKeys.detail(data.uuid), data);
        toast.success(t("vehicle_brands.toast.updated"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    remove: useMutation({
      mutationFn: vehicleBrandsService.remove,
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.deleted"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    uploadLogo: useMutation({
      mutationFn: ({ uuid, file }: { uuid: string; file: File }) =>
        vehicleBrandsService.uploadLogo(uuid, file),
      onSuccess: (data) => {
        invalidate();
        queryClient.setQueryData(vehicleBrandKeys.detail(data.uuid), data);
        toast.success(t("vehicle_brands.toast.logo"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    createModel: useMutation({
      mutationFn: ({
        brandUuid,
        name,
        years,
      }: {
        brandUuid: string;
        name: string;
        years?: number[];
      }) => vehicleBrandsService.createModel(brandUuid, { name, years }),
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.model"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    deleteModel: useMutation({
      mutationFn: vehicleBrandsService.deleteModel,
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.model"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    addYear: useMutation({
      mutationFn: ({ modelUuid, year }: { modelUuid: string; year: number }) =>
        vehicleBrandsService.addYear(modelUuid, year),
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.year"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    deleteYear: useMutation({
      mutationFn: ({ modelUuid, year }: { modelUuid: string; year: number }) =>
        vehicleBrandsService.deleteYear(modelUuid, year),
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.year"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
    importJson: useMutation({
      mutationFn: vehicleBrandsService.importJson,
      onSuccess: () => {
        invalidate();
        toast.success(t("vehicle_brands.toast.imported"));
      },
      onError: (err: Error) =>
        toast.error(err.message || t("vehicle_brands.toast.failed")),
    }),
  };
}
