import type { ServerListParams } from "@/components/entity";
import type { ResourceMeta } from "@/features/io/types";
import { platformRequest } from "@/lib/api/platform-request";

// TODO(finance): Add patchCategory, deleteCategory, getCategory service methods when edit flows ship.

export type FinanceAccount = {
  uuid: string;
  name: string;
  type: "cash" | "bank";
  currency: string;
  opening_balance: string;
  current_balance: string;
  is_default: boolean;
  is_active: boolean;
  bank_name?: string | null;
  iban?: string | null;
  notes: string;
  negative_balance?: boolean;
  created_at: string;
  updated_at: string;
};

export type FinanceCategory = {
  uuid: string;
  name: string;
  kind: "income" | "expense";
  parent_uuid?: string | null;
  sort_order: number;
  is_active: boolean;
};

export type FinanceTransaction = {
  uuid: string;
  type: "income" | "expense" | "transfer";
  status: "posted" | "void";
  account_uuid: string;
  account_name: string;
  counter_account_uuid?: string | null;
  counter_account_name?: string | null;
  category_uuid?: string | null;
  category_name?: string | null;
  amount: string;
  currency: string;
  transaction_date: string;
  description: string;
  reference_no?: string | null;
  payment_method: string;
  source_type?: string | null;
  source_uuid?: string | null;
  /** Detail endpoint only: the document behind the row with its lines. */
  source_detail?: FinanceSourceDetail | null;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
  voided_at?: string | null;
};

export type FinanceSourceDetail = {
  kind: "service_job" | "product_sale" | "purchase" | "cari_payment";
  uuid: string;
  title: string;
  subtitle?: string;
  plate?: string;
  date?: string;
  total?: string;
  currency?: string;
  lines: {
    type: "service" | "product" | "custom";
    name: string;
    qty: string;
    unit_price: string;
    line_total: string;
  }[];
};

export type FinanceAccountStats = {
  posted_count: number;
  void_count: number;
  total_income: string;
  total_expense: string;
  transfer_in: string;
  transfer_out: string;
};

export type FinanceCategoryStats = {
  posted_count: number;
  void_count: number;
  total_amount: string;
};

export type FinanceAccountDetail = {
  account: FinanceAccount;
  stats: FinanceAccountStats;
  recent_transactions: FinanceTransaction[];
};

export type FinanceCategoryDetail = {
  category: FinanceCategory;
  stats: FinanceCategoryStats;
  recent_transactions: FinanceTransaction[];
};

export type FinanceSummary = {
  date_from: string;
  date_to: string;
  currency?: string | null;
  total_income: string;
  total_expense: string;
  net: string;
  accounts: FinanceAccount[];
  expense_by_category: Array<{
    category_uuid: string;
    category_name: string;
    total: string;
  }>;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export const financeService = {
  summary(params?: {
    date_from?: string;
    date_to?: string;
    currency?: string;
  }) {
    return platformRequest<FinanceSummary>(
      "GET",
      "/v1/tenant/finance/summary",
      {
        query: params,
      },
    );
  },
  accountsMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/finance/accounts/meta",
    );
  },
  categoriesMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/finance/categories/meta",
    );
  },
  listAccounts(params?: ServerListParams & { is_active?: string }) {
    return platformRequest<ListPage<FinanceAccount>>(
      "GET",
      "/v1/tenant/finance/accounts",
      {
        query: params,
      },
    );
  },
  createAccount(body: Record<string, unknown>) {
    return platformRequest<FinanceAccount>(
      "POST",
      "/v1/tenant/finance/accounts",
      { body },
    );
  },
  patchAccount(uuid: string, body: Record<string, unknown>) {
    return platformRequest<FinanceAccount>(
      "PATCH",
      `/v1/tenant/finance/accounts/${uuid}`,
      {
        body,
      },
    );
  },
  deleteAccount(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/finance/accounts/${uuid}`,
    );
  },
  getAccount(uuid: string) {
    return platformRequest<FinanceAccount>(
      "GET",
      `/v1/tenant/finance/accounts/${uuid}`,
    );
  },
  getAccountDetail(uuid: string, params?: { limit?: number }) {
    return platformRequest<FinanceAccountDetail>(
      "GET",
      `/v1/tenant/finance/accounts/${uuid}/detail`,
      { query: params },
    );
  },
  listCategories(params?: { kind?: string; is_active?: string }) {
    return platformRequest<{ items: FinanceCategory[] }>(
      "GET",
      "/v1/tenant/finance/categories",
      { query: params },
    );
  },
  createCategory(body: Record<string, unknown>) {
    return platformRequest<FinanceCategory>(
      "POST",
      "/v1/tenant/finance/categories",
      {
        body,
      },
    );
  },
  getCategory(uuid: string) {
    return platformRequest<FinanceCategory>(
      "GET",
      `/v1/tenant/finance/categories/${uuid}`,
    );
  },
  getCategoryDetail(uuid: string, params?: { limit?: number }) {
    return platformRequest<FinanceCategoryDetail>(
      "GET",
      `/v1/tenant/finance/categories/${uuid}/detail`,
      { query: params },
    );
  },
  transactionsMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/finance/transactions/meta",
    );
  },
  listTransactions(
    params?: ServerListParams & {
      type?: string;
      status?: string;
      account_uuid?: string;
      category_uuid?: string;
      date_from?: string;
      date_to?: string;
    },
  ) {
    return platformRequest<ListPage<FinanceTransaction>>(
      "GET",
      "/v1/tenant/finance/transactions",
      { query: params },
    );
  },
  createTransaction(body: Record<string, unknown>) {
    return platformRequest<FinanceTransaction>(
      "POST",
      "/v1/tenant/finance/transactions",
      {
        body,
      },
    );
  },
  getTransaction(uuid: string) {
    return platformRequest<FinanceTransaction>(
      "GET",
      `/v1/tenant/finance/transactions/${uuid}`,
    );
  },
  voidTransaction(uuid: string) {
    return platformRequest<FinanceTransaction>(
      "POST",
      `/v1/tenant/finance/transactions/${uuid}/void`,
    );
  },
  createTransfer(body: Record<string, unknown>) {
    return platformRequest<FinanceTransaction>(
      "POST",
      "/v1/tenant/finance/transfers",
      {
        body,
      },
    );
  },
};
