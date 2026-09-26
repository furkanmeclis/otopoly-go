import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type PurchaseStatus = "posted" | "voided";
export type PurchaseMethod = "cash" | "card";

export type PurchaseLine = {
  uuid: string;
  product_uuid: string;
  name: string;
  unit_cost: string;
  qty: string;
  line_total: string;
  currency: string;
  sort_order: number;
};

export type Purchase = {
  uuid: string;
  supplier_uuid: string;
  supplier_name: string;
  status: PurchaseStatus;
  currency: string;
  total_amount: string;
  method: PurchaseMethod;
  finance_account_uuid?: string | null;
  finance_account_name?: string | null;
  finance_transaction_uuid?: string | null;
  notes: string;
  purchased_at: string;
  created_at: string;
  voided_at?: string | null;
};

export type PurchaseDetail = Purchase & {
  lines: PurchaseLine[];
};

/** List rows carry their lines so the table can show products and quantities. */
export type PurchaseListItem = PurchaseDetail;

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreatePurchaseInput = {
  supplier_uuid: string;
  notes?: string;
  method: PurchaseMethod;
  finance_account_uuid: string;
  currency?: string;
  purchased_at?: string;
  lines: Array<{
    product_uuid: string;
    unit_cost?: string;
    qty?: string;
  }>;
};

export const purchasesService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/purchases/meta");
  },
  list(
    params?: ServerListParams & {
      status?: string;
      date_from?: string;
      date_to?: string;
    },
  ) {
    return platformRequest<ListPage<PurchaseListItem>>(
      "GET",
      "/v1/tenant/purchases",
      {
        query: params,
      },
    );
  },
  get(uuid: string) {
    return platformRequest<PurchaseDetail>(
      "GET",
      `/v1/tenant/purchases/${uuid}`,
    );
  },
  create(body: CreatePurchaseInput) {
    return platformRequest<PurchaseDetail>("POST", "/v1/tenant/purchases", {
      body,
    });
  },
  void(uuid: string) {
    return platformRequest<PurchaseDetail>(
      "POST",
      `/v1/tenant/purchases/${uuid}/void`,
    );
  },
};
