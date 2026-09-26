const ACCOUNT_TYPE_KEYS = {
  cash: "finance.accounts.type_cash",
  bank: "finance.accounts.type_bank",
} as const;

const TRANSACTION_TYPE_KEYS = {
  income: "finance.transactions.type_income",
  expense: "finance.transactions.type_expense",
  transfer: "finance.transactions.type_transfer",
} as const;

const TRANSACTION_STATUS_KEYS = {
  posted: "finance.transactions.status_posted",
  void: "finance.transactions.status_void",
} as const;

const TRANSACTION_STATUS_HINT_KEYS = {
  posted: "finance.transactions.status_posted_hint",
  void: "finance.transactions.status_void_hint",
} as const;

const CATEGORY_KIND_KEYS = {
  income: "finance.categories.kind_income",
  expense: "finance.categories.kind_expense",
} as const;

const PAYMENT_METHOD_KEYS = {
  cash: "finance.payment_method.cash",
  card: "finance.payment_method.card",
  transfer: "finance.payment_method.transfer",
  other: "finance.payment_method.other",
} as const;

export function paymentMethodLabelKey(method: string): string | null {
  return (
    PAYMENT_METHOD_KEYS[method as keyof typeof PAYMENT_METHOD_KEYS] ?? null
  );
}

export function categoryKindLabelKey(kind: string): string {
  return (
    CATEGORY_KIND_KEYS[kind as keyof typeof CATEGORY_KIND_KEYS] ??
    "finance.categories.kind"
  );
}

export function accountTypeLabelKey(type: string): string {
  return (
    ACCOUNT_TYPE_KEYS[type as keyof typeof ACCOUNT_TYPE_KEYS] ??
    "finance.accounts.type"
  );
}

export function transactionTypeLabelKey(type: string): string {
  return (
    TRANSACTION_TYPE_KEYS[type as keyof typeof TRANSACTION_TYPE_KEYS] ??
    "finance.transactions.type"
  );
}

export function transactionStatusLabelKey(status: string): string {
  return (
    TRANSACTION_STATUS_KEYS[status as keyof typeof TRANSACTION_STATUS_KEYS] ??
    "finance.transactions.status"
  );
}

export function transactionStatusHintKey(status: string): string {
  return (
    TRANSACTION_STATUS_HINT_KEYS[
      status as keyof typeof TRANSACTION_STATUS_HINT_KEYS
    ] ?? "finance.transactions.status"
  );
}
