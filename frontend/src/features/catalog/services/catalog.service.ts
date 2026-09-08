import type { ServerListParams } from "@/components/entity";
import type { ResourceMeta } from "@/features/io/types";
import { platformRequest } from "@/lib/api/platform-request";

export type CatalogCategory = {
  uuid: string;
  name: string;
  kind: "product" | "service";
  parent_uuid?: string | null;
  parent_name?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CatalogProduct = {
  uuid: string;
  name: string;
  category_uuid?: string | null;
  category_name?: string | null;
  sku: string;
  barcode: string;
  unit: string;
  cost_price: string;
  sale_price: string;
  vat_rate: string;
  currency: string;
  stock_quantity: string;
  min_stock_alert: string;
  track_stock: boolean;
  stock_status: "in_stock" | "low_stock" | "out_of_stock" | "untracked";
  is_active: boolean;
  description: string;
  created_at: string;
  updated_at: string;
};

export type CatalogService = {
  uuid: string;
  name: string;
  category_uuid?: string | null;
  category_name?: string | null;
  code: string;
  duration_minutes: number;
  price: string;
  vat_rate: string;
  currency: string;
  is_active: boolean;
  description: string;
  created_at: string;
  updated_at: string;
};

export type CatalogSummary = {
  total_products: number;
  active_products: number;
  low_stock_products: number;
  out_of_stock_products: number;
  total_stock_cost_value: string;
  total_stock_sale_value: string;
  total_services: number;
  active_services: number;
  total_categories: number;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateCategoryInput = {
  name: string;
  kind: "product" | "service";
  parent_uuid?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export type CreateProductInput = {
  name: string;
  category_uuid?: string | null;
  sku?: string;
  barcode?: string;
  unit?: string;
  cost_price?: string;
  sale_price?: string;
  vat_rate?: string;
  currency?: string;
  stock_quantity?: string;
  min_stock_alert?: string;
  track_stock?: boolean;
  is_active?: boolean;
  description?: string;
};

export type UpdateProductInput = Partial<CreateProductInput>;

export type AdjustStockInput = {
  delta: string;
  reason?: string;
  description?: string;
};

export type CreateServiceInput = {
  name: string;
  category_uuid?: string | null;
  code?: string;
  duration_minutes?: number;
  price?: string;
  vat_rate?: string;
  currency?: string;
  is_active?: boolean;
  description?: string;
};

export type UpdateServiceInput = Partial<CreateServiceInput>;

export const catalogService = {
  summary() {
    return platformRequest<CatalogSummary>(
      "GET",
      "/v1/tenant/catalog/summary",
    );
  },

  // Products
  productsMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/catalog/products/meta",
    );
  },
  listProducts(
    params?: ServerListParams & {
      category_uuid?: string;
      stock_status?: string;
      is_active?: string;
      track_stock?: string;
      unit?: string;
    },
  ) {
    return platformRequest<ListPage<CatalogProduct>>(
      "GET",
      "/v1/tenant/catalog/products",
      { query: params },
    );
  },
  getProduct(uuid: string) {
    return platformRequest<CatalogProduct>(
      "GET",
      `/v1/tenant/catalog/products/${uuid}`,
    );
  },
  createProduct(body: CreateProductInput) {
    return platformRequest<CatalogProduct>(
      "POST",
      "/v1/tenant/catalog/products",
      { body },
    );
  },
  updateProduct(uuid: string, body: UpdateProductInput) {
    return platformRequest<CatalogProduct>(
      "PATCH",
      `/v1/tenant/catalog/products/${uuid}`,
      { body },
    );
  },
  adjustProductStock(uuid: string, body: AdjustStockInput) {
    return platformRequest<CatalogProduct>(
      "POST",
      `/v1/tenant/catalog/products/${uuid}/stock-adjustment`,
      { body },
    );
  },
  deleteProduct(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/catalog/products/${uuid}`,
    );
  },

  // Services
  servicesMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/catalog/services/meta",
    );
  },
  listServices(
    params?: ServerListParams & {
      category_uuid?: string;
      is_active?: string;
    },
  ) {
    return platformRequest<ListPage<CatalogService>>(
      "GET",
      "/v1/tenant/catalog/services",
      { query: params },
    );
  },
  getService(uuid: string) {
    return platformRequest<CatalogService>(
      "GET",
      `/v1/tenant/catalog/services/${uuid}`,
    );
  },
  createService(body: CreateServiceInput) {
    return platformRequest<CatalogService>(
      "POST",
      "/v1/tenant/catalog/services",
      { body },
    );
  },
  updateService(uuid: string, body: UpdateServiceInput) {
    return platformRequest<CatalogService>(
      "PATCH",
      `/v1/tenant/catalog/services/${uuid}`,
      { body },
    );
  },
  deleteService(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/catalog/services/${uuid}`,
    );
  },

  // Categories
  categoriesMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/catalog/categories/meta",
    );
  },
  listCategories(params?: {
    kind?: string;
    is_active?: string;
    q?: string;
  }) {
    return platformRequest<{ items: CatalogCategory[] }>(
      "GET",
      "/v1/tenant/catalog/categories",
      { query: params },
    );
  },
  getCategory(uuid: string) {
    return platformRequest<CatalogCategory>(
      "GET",
      `/v1/tenant/catalog/categories/${uuid}`,
    );
  },
  createCategory(body: CreateCategoryInput) {
    return platformRequest<CatalogCategory>(
      "POST",
      "/v1/tenant/catalog/categories",
      { body },
    );
  },
  updateCategory(uuid: string, body: UpdateCategoryInput) {
    return platformRequest<CatalogCategory>(
      "PATCH",
      `/v1/tenant/catalog/categories/${uuid}`,
      { body },
    );
  },
  deleteCategory(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/catalog/categories/${uuid}`,
    );
  },
};
