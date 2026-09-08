import type { ServerListParams } from "@/components/entity";
import { platformFormRequest } from "@/lib/api/platform-form-request";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type VehicleBrand = {
  uuid: string;
  name: string;
  logo_url?: string | null;
  is_active: boolean;
  model_count: number;
  created_at: string;
  updated_at: string;
};

export type VehicleModel = {
  uuid: string;
  name: string;
  is_active: boolean;
  years: number[];
  created_at: string;
  updated_at: string;
};

export type VehicleBrandDetail = VehicleBrand & {
  models: VehicleModel[];
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type ImportResult = {
  brands_created: number;
  brands_updated: number;
  models_created: number;
  years_added: number;
};

export const vehicleBrandsService = {
  meta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/platform/vehicle-brands/meta",
    );
  },
  list(params?: ServerListParams & { is_active?: string }) {
    return platformRequest<ListPage<VehicleBrand>>(
      "GET",
      "/v1/platform/vehicle-brands",
      { query: params },
    );
  },
  get(uuid: string) {
    return platformRequest<VehicleBrandDetail>(
      "GET",
      `/v1/platform/vehicle-brands/${uuid}`,
    );
  },
  create(body: { name: string; is_active?: boolean }) {
    return platformRequest<VehicleBrand>(
      "POST",
      "/v1/platform/vehicle-brands",
      {
        body,
      },
    );
  },
  update(uuid: string, body: { name?: string; is_active?: boolean }) {
    return platformRequest<VehicleBrandDetail>(
      "PATCH",
      `/v1/platform/vehicle-brands/${uuid}`,
      { body },
    );
  },
  remove(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/platform/vehicle-brands/${uuid}`,
    );
  },
  uploadLogo(uuid: string, file: File) {
    const form = new FormData();
    form.append("logo", file);
    return platformFormRequest<VehicleBrandDetail>(
      "PUT",
      `/v1/platform/vehicle-brands/${uuid}/logo`,
      form,
    );
  },
  createModel(brandUuid: string, body: { name: string; years?: number[] }) {
    return platformRequest<VehicleModel>(
      "POST",
      `/v1/platform/vehicle-brands/${brandUuid}/models`,
      { body },
    );
  },
  deleteModel(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/platform/vehicle-models/${uuid}`,
    );
  },
  addYear(modelUuid: string, year: number) {
    return platformRequest<{ year: number }>(
      "POST",
      `/v1/platform/vehicle-models/${modelUuid}/years`,
      { body: { year } },
    );
  },
  deleteYear(modelUuid: string, year: number) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/platform/vehicle-models/${modelUuid}/years/${year}`,
    );
  },
  importJson(payload: Record<string, Record<string, string[]>>) {
    return platformRequest<ImportResult>(
      "POST",
      "/v1/platform/vehicle-brands/import",
      { body: payload },
    );
  },
};
