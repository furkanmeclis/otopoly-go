export type ExportFormat = "pdf" | "xlsx" | "csv" | "json";
export type ImportFormat = "json" | "xlsx" | "csv" | "tsv";

import type { BulkActionMeta } from "@/features/bulk-engine/types";

export type ResourceCapabilities = {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
  search?: boolean;
  filter?: boolean;
  sort?: boolean;
  export?: boolean;
  import?: boolean;
  bulk?: boolean;
};

export type ResourceMeta = {
  resource?: string;
  capabilities?: ResourceCapabilities;
  sortable?: string[];
  filterable?: string[];
  bulk_actions?: BulkActionMeta[];
};

export type ExportJob = {
  uuid: string;
  resource: string;
  format: string;
  status: string;
  row_count: number;
  error?: string | null;
  download_url?: string | null;
  created_at: string;
};

export type ImportJob = {
  uuid: string;
  resource: string;
  format: string;
  status: string;
  mapping?: Record<string, string>;
  defaults?: Record<string, string>;
  preview_summary?: ImportPreviewSummary;
  error?: string | null;
  rollback_until?: string | null;
  applied_at?: string | null;
  created_at: string;
};

export type ImportPreviewSummary = {
  total: number;
  valid: number;
  invalid: number;
  rows?: { index: number; data: Record<string, unknown> }[];
  errors?: { index: number; field?: string; error: string }[];
};

export type AppSettings = {
  company_name: string;
  tagline: string;
  primary_color: string;
  address: string;
  city?: string;
  district?: string;
  phone: string;
  email: string;
  website: string;
  footer_text: string;
  paper_size: string;
  logo_url?: string | null;
};

export type ActivityEvent = {
  uuid: string;
  actor_user_id?: number | null;
  action: string;
  resource: string;
  resource_uuid?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ExportJobScope = "platform" | "tenant";

export type IoResource =
  | "platform.users"
  | "platform.roles"
  | "platform.notifications"
  | "platform.activity"
  | "tenant.finance.accounts"
  | "tenant.finance.categories"
  | "tenant.finance.transactions"
  | "tenant.catalog.products"
  | "tenant.catalog.services"
  | "tenant.catalog.categories";

export const EXPORT_PATHS: Record<IoResource, string> = {
  "platform.users": "/v1/platform/users/export",
  "platform.roles": "/v1/platform/roles/export",
  "platform.notifications": "/v1/platform/notifications/export",
  "platform.activity": "/v1/platform/activity/export",
  "tenant.finance.accounts": "/v1/tenant/finance/accounts/export",
  "tenant.finance.categories": "/v1/tenant/finance/categories/export",
  "tenant.finance.transactions": "/v1/tenant/finance/transactions/export",
  "tenant.catalog.products": "/v1/tenant/exports",
  "tenant.catalog.services": "/v1/tenant/exports",
  "tenant.catalog.categories": "/v1/tenant/exports",
};

export const IMPORT_PATHS: Partial<
  Record<IoResource, { upload: string; sample: string }>
> = {
  "platform.users": {
    upload: "/v1/platform/users/import",
    sample: "/v1/platform/users/import/sample",
  },
  "platform.roles": {
    upload: "/v1/platform/roles/import",
    sample: "/v1/platform/roles/import/sample",
  },
  "tenant.finance.accounts": {
    upload: "/v1/tenant/finance/accounts/import",
    sample: "/v1/tenant/finance/accounts/import/sample",
  },
  "tenant.finance.categories": {
    upload: "/v1/tenant/finance/categories/import",
    sample: "/v1/tenant/finance/categories/import/sample",
  },
  "tenant.catalog.products": {
    upload: "/v1/tenant/imports",
    sample: "/v1/tenant/imports/sample?resource=tenant.catalog.products",
  },
  "tenant.catalog.services": {
    upload: "/v1/tenant/imports",
    sample: "/v1/tenant/imports/sample?resource=tenant.catalog.services",
  },
  "tenant.catalog.categories": {
    upload: "/v1/tenant/imports",
    sample: "/v1/tenant/imports/sample?resource=tenant.catalog.categories",
  },
};

export const IMPORT_SCHEMA: Partial<
  Record<IoResource, { key: string; labelKey: string; required?: boolean }[]>
> = {
  "platform.users": [
    { key: "email", labelKey: "users.fields.email", required: true },
    { key: "name", labelKey: "users.fields.name", required: true },
    { key: "surname", labelKey: "users.fields.surname", required: true },
    { key: "status", labelKey: "users.fields.status" },
    { key: "locale", labelKey: "users.fields.locale" },
    { key: "role_slugs", labelKey: "users.fields.roles" },
  ],
  "platform.roles": [
    { key: "name", labelKey: "roles.fields.name", required: true },
    { key: "slug", labelKey: "roles.fields.slug", required: true },
    { key: "description", labelKey: "roles.fields.description" },
    { key: "permission_slugs", labelKey: "roles.fields.permissions" },
  ],
  "tenant.finance.accounts": [
    { key: "name", labelKey: "finance.accounts.name", required: true },
    { key: "type", labelKey: "finance.accounts.type", required: true },
    { key: "currency", labelKey: "finance.accounts.currency" },
    { key: "opening_balance", labelKey: "finance.accounts.opening_balance" },
    { key: "is_default", labelKey: "finance.accounts.is_default" },
    { key: "is_active", labelKey: "finance.accounts.is_active" },
    { key: "bank_name", labelKey: "finance.accounts.bank_name" },
    { key: "iban", labelKey: "finance.accounts.iban" },
    { key: "notes", labelKey: "finance.accounts.notes" },
  ],
  "tenant.finance.categories": [
    { key: "name", labelKey: "finance.categories.name", required: true },
    { key: "kind", labelKey: "finance.categories.kind", required: true },
    { key: "sort_order", labelKey: "finance.categories.sort_order" },
    { key: "is_active", labelKey: "finance.categories.is_active" },
  ],
  "tenant.catalog.products": [
    { key: "name", labelKey: "catalog.products.name", required: true },
    { key: "category", labelKey: "catalog.products.category" },
    { key: "sku", labelKey: "catalog.products.sku" },
    { key: "barcode", labelKey: "catalog.products.barcode" },
    { key: "unit", labelKey: "catalog.products.unit" },
    { key: "sale_price", labelKey: "catalog.products.sale_price" },
    { key: "cost_price", labelKey: "catalog.products.cost_price" },
    { key: "vat_rate", labelKey: "catalog.products.vat_rate" },
    { key: "currency", labelKey: "catalog.products.currency" },
    { key: "stock_quantity", labelKey: "catalog.products.stock_quantity" },
    { key: "min_stock_alert", labelKey: "catalog.products.min_stock_alert" },
    { key: "track_stock", labelKey: "catalog.products.track_stock" },
    { key: "is_active", labelKey: "catalog.products.is_active" },
    { key: "description", labelKey: "catalog.products.description" },
  ],
  "tenant.catalog.services": [
    { key: "name", labelKey: "catalog.services.name", required: true },
    { key: "category", labelKey: "catalog.services.category" },
    { key: "code", labelKey: "catalog.services.code" },
    { key: "duration_minutes", labelKey: "catalog.services.duration" },
    { key: "price", labelKey: "catalog.services.price" },
    { key: "vat_rate", labelKey: "catalog.services.vat_rate" },
    { key: "currency", labelKey: "catalog.services.currency" },
    { key: "is_active", labelKey: "catalog.services.is_active" },
    { key: "description", labelKey: "catalog.services.description" },
  ],
  "tenant.catalog.categories": [
    { key: "name", labelKey: "catalog.categories.name", required: true },
    { key: "kind", labelKey: "catalog.categories.kind", required: true },
    { key: "sort_order", labelKey: "catalog.categories.sort_order" },
    { key: "is_active", labelKey: "catalog.categories.is_active" },
  ],
};
