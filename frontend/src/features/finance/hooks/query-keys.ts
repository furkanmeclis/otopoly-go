export const financeQueryKeys = {
  all: ["finance"] as const,
  summary: (params?: Record<string, string | undefined>) =>
    [...financeQueryKeys.all, "summary", params] as const,
  accounts: (params?: Record<string, unknown>) =>
    [...financeQueryKeys.all, "accounts", params] as const,
  accountsMeta: () => [...financeQueryKeys.all, "accounts-meta"] as const,
  categoriesMeta: () => [...financeQueryKeys.all, "categories-meta"] as const,
  account: (uuid: string) =>
    [...financeQueryKeys.all, "account", uuid] as const,
  accountDetail: (uuid: string, params?: Record<string, unknown>) =>
    [...financeQueryKeys.all, "account-detail", uuid, params] as const,
  categories: (params?: Record<string, unknown>) =>
    [...financeQueryKeys.all, "categories", params] as const,
  category: (uuid: string) =>
    [...financeQueryKeys.all, "category", uuid] as const,
  categoryDetail: (uuid: string, params?: Record<string, unknown>) =>
    [...financeQueryKeys.all, "category-detail", uuid, params] as const,
  transactions: (params?: Record<string, unknown>) =>
    [...financeQueryKeys.all, "transactions", params] as const,
  transaction: (uuid: string) =>
    [...financeQueryKeys.all, "transaction", uuid] as const,
  transactionsMeta: () =>
    [...financeQueryKeys.all, "transactions-meta"] as const,
};
