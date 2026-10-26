import type { components } from "@/generated/api";
import { apiClient, unwrap } from "@/lib/api";
import { platformRequest } from "@/lib/api/platform-request";
import type { PurchaseDetail } from "@/features/purchases/services/purchases.service";

type Schemas = components["schemas"];

export type ReorderUrgency = "out_of_stock" | "below_min" | "low_cover";
export type ReorderSuggestion = Schemas["StockReorderSuggestion"];
export type ReorderSummary = Schemas["StockReorderSummary"];
export type ReorderSettings = Schemas["StockReorderSettings"];
export type ReorderList = Schemas["StockReorderList"];
export type ReorderProductOverride = Schemas["StockReorderProductOverride"];

export type ReorderListParams = {
  urgency?: ReorderUrgency;
  supplier_uuid?: string;
  q?: string;
  all?: boolean;
};

export type ReorderSettingsInput = {
  velocity_days: number;
  lead_days: number;
  target_days: number;
  notify_enabled: boolean;
  supplier_lead_days?: { supplier_uuid: string; lead_days: number }[];
};

export type ReorderOverrideInput = {
  supplier_uuid?: string | null;
  lead_days?: number | null;
  target_days?: number | null;
  pack_size?: string | null;
};

export type CreateReorderDraftsInput = {
  notes?: string;
  items: {
    product_uuid: string;
    qty: string;
    supplier_uuid?: string | null;
    unit_cost?: string | null;
  }[];
};

export type PostDraftInput = {
  method: "cash" | "card";
  finance_account_uuid: string;
  purchased_at?: string;
  notes?: string;
  lines?: { product_uuid: string; qty?: string; unit_cost?: string }[];
};

export const stockReorderService = {
  list(params?: ReorderListParams) {
    return platformRequest<ReorderList>(
      "GET",
      "/v1/tenant/stock-reorder/suggestions",
      {
        query: {
          urgency: params?.urgency,
          supplier_uuid: params?.supplier_uuid,
          q: params?.q,
          all: params?.all ? "true" : undefined,
        },
      },
    );
  },
  /** Silent: the sidebar badge and dashboard card must not open the plan dialog. */
  async summary() {
    return unwrap<ReorderSummary>(
      await apiClient.GET("/v1/tenant/stock-reorder/summary"),
      { silent: true },
    );
  },
  /** Silent list for the dashboard card (urgent items only). */
  async urgentPreview() {
    return unwrap<ReorderList>(
      await apiClient.GET("/v1/tenant/stock-reorder/suggestions"),
      { silent: true },
    );
  },
  settings() {
    return platformRequest<ReorderSettings>(
      "GET",
      "/v1/tenant/stock-reorder/settings",
    );
  },
  updateSettings(body: ReorderSettingsInput) {
    return platformRequest<ReorderSettings>(
      "PUT",
      "/v1/tenant/stock-reorder/settings",
      { body },
    );
  },
  productOverride(productUuid: string) {
    return platformRequest<{
      product_uuid: string;
      override: ReorderProductOverride | null;
    }>("GET", `/v1/tenant/stock-reorder/products/${productUuid}`);
  },
  setProductOverride(productUuid: string, body: ReorderOverrideInput) {
    return platformRequest<{
      product_uuid: string;
      override: ReorderProductOverride | null;
    }>("PUT", `/v1/tenant/stock-reorder/products/${productUuid}`, { body });
  },
  createDrafts(body: CreateReorderDraftsInput) {
    return platformRequest<{ drafts: PurchaseDetail[] }>(
      "POST",
      "/v1/tenant/stock-reorder/drafts",
      { body },
    );
  },
  postDraft(uuid: string, body: PostDraftInput) {
    return platformRequest<PurchaseDetail>(
      "POST",
      `/v1/tenant/purchases/${uuid}/post`,
      { body },
    );
  },
  deleteDraft(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/purchases/${uuid}`,
    );
  },
};
