import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type CariAccount = {
  uuid: string;
  customer_uuid: string;
  customer_name: string;
  customer_phone: string;
  customer_kind?: string;
  currency: string;
  balance: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CariAccountDetail = CariAccount & {
  customer_email: string;
  customer_tax_id?: string;
  customer_tax_office?: string;
  customer_is_active: boolean;
};

export type CariEntry = {
  uuid: string;
  account_uuid: string;
  type: "charge" | "payment" | "adjustment" | "opening";
  status: "posted" | "void";
  amount: string;
  balance_after: string;
  entry_date: string;
  description: string;
  reference_no?: string | null;
  payment_method?: string | null;
  finance_account_uuid?: string | null;
  finance_account_name?: string | null;
  finance_transaction_uuid?: string | null;
  created_at: string;
  voided_at?: string | null;
};

export type CariSummary = {
  total_receivable: string;
  account_count: number;
  with_balance_count: number;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type ChargeInput = {
  amount: string;
  entry_date: string;
  description?: string;
  reference_no?: string;
};

export type PaymentInput = {
  amount: string;
  entry_date: string;
  finance_account_uuid: string;
  description?: string;
  reference_no?: string;
  payment_method?: "cash" | "card" | "transfer" | "other";
};

export type AdjustmentInput = {
  amount: string;
  direction: "increase" | "decrease";
  entry_date: string;
  description?: string;
  reference_no?: string;
};

export const cariService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/cari/meta");
  },
  summary() {
    return platformRequest<CariSummary>("GET", "/v1/tenant/cari/summary");
  },
  list(
    params?: ServerListParams & { is_active?: string; has_balance?: string },
  ) {
    return platformRequest<ListPage<CariAccount>>("GET", "/v1/tenant/cari", {
      query: params,
    });
  },
  get(uuid: string) {
    return platformRequest<CariAccountDetail>("GET", `/v1/tenant/cari/${uuid}`);
  },
  listEntries(
    accountUuid: string,
    params?: ServerListParams & {
      type?: string;
      status?: string;
      date_from?: string;
      date_to?: string;
    },
  ) {
    return platformRequest<ListPage<CariEntry>>(
      "GET",
      `/v1/tenant/cari/${accountUuid}/entries`,
      { query: params },
    );
  },
  charge(accountUuid: string, body: ChargeInput) {
    return platformRequest<CariEntry>(
      "POST",
      `/v1/tenant/cari/${accountUuid}/charges`,
      { body },
    );
  },
  payment(accountUuid: string, body: PaymentInput) {
    return platformRequest<CariEntry>(
      "POST",
      `/v1/tenant/cari/${accountUuid}/payments`,
      { body },
    );
  },
  adjustment(accountUuid: string, body: AdjustmentInput) {
    return platformRequest<CariEntry>(
      "POST",
      `/v1/tenant/cari/${accountUuid}/adjustments`,
      { body },
    );
  },
  voidEntry(entryUuid: string) {
    return platformRequest<CariEntry>(
      "POST",
      `/v1/tenant/cari/entries/${entryUuid}/void`,
    );
  },
};
