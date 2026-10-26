import type { components } from "@/api/generated/api";
import type { ServerListParams } from "@/api/types";
import { platformRequest } from "@/api/client";
import type { ResourceMeta } from "@/features/io/types";

export type CustomerVehicle = {
  uuid: string;
  plate: string;
  brand_uuid: string;
  brand_name: string;
  logo_url?: string | null;
  model_uuid: string;
  model_name: string;
  year: number;
  created_at: string;
};

export type Customer = {
  uuid: string;
  name: string;
  phone: string;
  email: string;
  kind: "individual" | "company";
  notes: string;
  tax_id: string;
  tax_office: string;
  is_active: boolean;
  vehicle_count: number;
  cari_account_uuid?: string | null;
  cari_balance?: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerDetail = Customer & {
  vehicles: CustomerVehicle[];
};

export type VehicleCatalogOption = {
  brand_uuid: string;
  brand_name: string;
  logo_url?: string | null;
  model_uuid: string;
  model_name: string;
  year: number;
};

export function catalogPickerOptions(items: VehicleCatalogOption[]) {
  return items.map((item) => ({
    value: `${item.model_uuid}:${item.year}`,
    label: `${item.brand_name} ${item.model_name} · ${item.year}`,
    description: item.brand_name,
  }));
}

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateVehicleInput = {
  plate: string;
  model_uuid: string;
  year: number;
};

/** One entry of the customer activity feed (`GET /v1/tenant/customers/{uuid}/activity`), newest first. */
export type CustomerActivityEntry = components["schemas"]["CustomerActivityEntry"];
export type CustomerActivitySubject = CustomerActivityEntry["subject"];

export const customersService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/customers/meta");
  },
  list(params?: ServerListParams & { kind?: string; is_active?: string }) {
    return platformRequest<ListPage<Customer>>("GET", "/v1/tenant/customers", {
      query: params,
    });
  },
  get(uuid: string) {
    return platformRequest<CustomerDetail>(
      "GET",
      `/v1/tenant/customers/${uuid}`,
    );
  },
  create(body: {
    name: string;
    phone?: string;
    email?: string;
    kind?: string;
    notes?: string;
    tax_id?: string;
    tax_office?: string;
    is_active?: boolean;
    vehicle?: CreateVehicleInput;
  }) {
    return platformRequest<CustomerDetail>("POST", "/v1/tenant/customers", {
      body,
    });
  },
  update(
    uuid: string,
    body: {
      name?: string;
      phone?: string;
      email?: string;
      kind?: string;
      notes?: string;
      tax_id?: string;
      tax_office?: string;
      is_active?: boolean;
    },
  ) {
    return platformRequest<CustomerDetail>(
      "PATCH",
      `/v1/tenant/customers/${uuid}`,
      {
        body,
      },
    );
  },
  remove(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/customers/${uuid}`,
    );
  },
  addVehicle(customerUuid: string, body: CreateVehicleInput) {
    return platformRequest<CustomerVehicle>(
      "POST",
      `/v1/tenant/customers/${customerUuid}/vehicles`,
      { body },
    );
  },
  removeVehicle(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/customer-vehicles/${uuid}`,
    );
  },
  activity(uuid: string, params?: { limit?: number; offset?: number }) {
    return platformRequest<ListPage<CustomerActivityEntry>>(
      "GET",
      `/v1/tenant/customers/${uuid}/activity`,
      { query: params },
    );
  },
  searchCatalog(q: string) {
    return platformRequest<{ items: VehicleCatalogOption[] }>(
      "GET",
      "/v1/tenant/vehicle-catalog/search",
      { query: { q, limit: 20 } },
    );
  },
};
