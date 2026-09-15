import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type Supplier = {
  uuid: string;
  name: string;
  phone: string;
  email: string;
  tax_id: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateSupplierInput = {
  name: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  notes?: string;
  is_active?: boolean;
};

export type UpdateSupplierInput = {
  name?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
  notes?: string;
  is_active?: boolean;
};

export const suppliersService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/suppliers/meta");
  },
  list(params?: ServerListParams & { is_active?: string }) {
    return platformRequest<ListPage<Supplier>>("GET", "/v1/tenant/suppliers", {
      query: params,
    });
  },
  get(uuid: string) {
    return platformRequest<Supplier>("GET", `/v1/tenant/suppliers/${uuid}`);
  },
  create(body: CreateSupplierInput) {
    return platformRequest<Supplier>("POST", "/v1/tenant/suppliers", { body });
  },
  update(uuid: string, body: UpdateSupplierInput) {
    return platformRequest<Supplier>("PATCH", `/v1/tenant/suppliers/${uuid}`, {
      body,
    });
  },
  remove(uuid: string) {
    return platformRequest<void>("DELETE", `/v1/tenant/suppliers/${uuid}`);
  },
};
