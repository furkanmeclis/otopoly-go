import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type SaleStatus = "posted" | "voided";
export type SaleMethod = "cash" | "card" | "cari";

export type SaleLine = {
  uuid: string;
  product_uuid: string;
  name: string;
  unit_price: string;
  qty: string;
  vat_rate: string;
  line_total: string;
  currency: string;
  sort_order: number;
};

export type Sale = {
  uuid: string;
  customer_uuid?: string | null;
  customer_name: string;
  customer_phone: string;
  status: SaleStatus;
  currency: string;
  total_amount: string;
  method: SaleMethod;
  finance_account_uuid?: string | null;
  finance_account_name?: string | null;
  finance_transaction_uuid?: string | null;
  cari_entry_uuid?: string | null;
  notes: string;
  sold_at: string;
  created_at: string;
  voided_at?: string | null;
};

export type SaleDetail = Sale & {
  lines: SaleLine[];
};

export type SalesSummary = {
  sale_count: number;
  card_total: string;
  cari_total: string;
  net_total: string;
  paid_total: string;
  date: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateSaleInput = {
  customer_uuid?: string | null;
  notes?: string;
  method: SaleMethod;
  finance_account_uuid?: string;
  currency?: string;
  sold_at?: string;
  lines: Array<{
    product_uuid: string;
    unit_price?: string;
    qty?: string;
  }>;
};

export const salesService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/sales/meta");
  },
  summary(date?: string) {
    return platformRequest<SalesSummary>("GET", "/v1/tenant/sales/summary", {
      query: date ? { date } : undefined,
    });
  },
  list(
    params?: ServerListParams & {
      status?: string;
      date_from?: string;
      date_to?: string;
    },
  ) {
    return platformRequest<ListPage<Sale>>("GET", "/v1/tenant/sales", {
      query: params,
    });
  },
  get(uuid: string) {
    return platformRequest<SaleDetail>("GET", `/v1/tenant/sales/${uuid}`);
  },
  create(body: CreateSaleInput) {
    return platformRequest<SaleDetail>("POST", "/v1/tenant/sales", { body });
  },
  void(uuid: string) {
    return platformRequest<SaleDetail>("POST", `/v1/tenant/sales/${uuid}/void`);
  },
};
