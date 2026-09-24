/** Static i18n key maps (no dynamic `t()` keys, so check-i18n can verify them). */

const TOOL_LABEL_KEYS: Record<string, string> = {
  search_customers: "ai.tools.search_customers",
  get_customer_account: "ai.tools.get_customer_account",
  list_jobs: "ai.tools.list_jobs",
  get_report_summary: "ai.tools.get_report_summary",
  get_finance_balances: "ai.tools.get_finance_balances",
  get_sales_summary: "ai.tools.get_sales_summary",
  search_products: "ai.tools.search_products",
  render_chart: "ai.tools.render_chart",
  record_cari_payment: "ai.tools.record_cari_payment",
  record_cari_charge: "ai.tools.record_cari_charge",
  record_finance_entry: "ai.tools.record_finance_entry",
  create_finance_transfer: "ai.tools.create_finance_transfer",
  create_customer: "ai.tools.create_customer",
  search_vehicle_models: "ai.tools.search_vehicle_models",
  add_customer_vehicle: "ai.tools.add_customer_vehicle",
  create_job: "ai.tools.create_job",
  update_job_status: "ai.tools.update_job_status",
  create_quick_sale: "ai.tools.create_quick_sale",
  create_todo: "ai.tools.create_todo",
  list_todos: "ai.tools.list_todos",
  complete_todo: "ai.tools.complete_todo",
  update_plan: "ai.tools.update_plan",
};

const TOOL_RUNNING_KEYS: Record<string, string> = {
  search_customers: "ai.tools_running.search_customers",
  get_customer_account: "ai.tools_running.get_customer_account",
  list_jobs: "ai.tools_running.list_jobs",
  get_report_summary: "ai.tools_running.get_report_summary",
  get_finance_balances: "ai.tools_running.get_finance_balances",
  get_sales_summary: "ai.tools_running.get_sales_summary",
  search_products: "ai.tools_running.search_products",
  render_chart: "ai.tools_running.render_chart",
  record_cari_payment: "ai.tools_running.record_cari_payment",
  record_cari_charge: "ai.tools_running.record_cari_charge",
  record_finance_entry: "ai.tools_running.record_finance_entry",
  create_finance_transfer: "ai.tools_running.create_finance_transfer",
  create_customer: "ai.tools_running.create_customer",
  search_vehicle_models: "ai.tools_running.search_vehicle_models",
  add_customer_vehicle: "ai.tools_running.add_customer_vehicle",
  create_job: "ai.tools_running.create_job",
  update_job_status: "ai.tools_running.update_job_status",
  create_quick_sale: "ai.tools_running.create_quick_sale",
  create_todo: "ai.tools_running.create_todo",
  list_todos: "ai.tools_running.list_todos",
  complete_todo: "ai.tools_running.complete_todo",
  update_plan: "ai.tools_running.update_plan",
};

const UNAVAILABLE_KEYS: Record<string, string> = {
  disabled: "ai.unavailable.disabled",
  not_configured: "ai.unavailable.not_configured",
  org_disabled: "ai.unavailable.org_disabled",
  quota_exceeded: "ai.unavailable.quota_exceeded",
};

const ERROR_KEYS: Record<string, string> = {
  provider_error: "ai.errors.provider_error",
  quota_exceeded: "ai.errors.quota_exceeded",
  refusal: "ai.errors.refusal",
  max_tokens: "ai.errors.max_tokens",
  internal_error: "ai.errors.internal_error",
  network: "ai.errors.network",
  AI_QUOTA_EXCEEDED: "ai.errors.quota_exceeded",
  AI_DISABLED: "ai.unavailable.disabled",
  AI_NOT_CONFIGURED: "ai.unavailable.not_configured",
  AI_ORG_DISABLED: "ai.unavailable.org_disabled",
  AI_CONVERSATION_LIMIT: "ai.errors.conversation_limit",
  RATE_LIMITED: "ai.errors.rate_limited",
};

export function toolLabelKey(name: string) {
  return TOOL_LABEL_KEYS[name] ?? "ai.tools.unknown";
}

export function toolRunningKey(name: string) {
  return TOOL_RUNNING_KEYS[name] ?? "ai.tools_running.unknown";
}

export function unavailableKey(reason?: string | null) {
  return (reason && UNAVAILABLE_KEYS[reason]) || "ai.unavailable.title";
}

export function errorKey(code?: string | null) {
  return (code && ERROR_KEYS[code]) || "ai.errors.generic";
}

/** Backend summary keys look like `ai.tool_summary.*`; accept only those. */
export function isSummaryKey(key?: string | null): key is string {
  return Boolean(key && /^ai\.tool_summary\.[a-z_]+$/.test(key));
}

const CONFIRM_FIELD_KEYS: Record<string, string> = {
  customer: "ai.confirm.fields.customer",
  payment_method: "ai.confirm.fields.payment_method",
  finance_account: "ai.confirm.fields.finance_account",
  date: "ai.confirm.fields.date",
  balance_before: "ai.confirm.fields.balance_before",
  balance_after: "ai.confirm.fields.balance_after",
  description: "ai.confirm.fields.description",
  entry_type: "ai.confirm.fields.entry_type",
  category: "ai.confirm.fields.category",
  account_balance_after: "ai.confirm.fields.account_balance_after",
  from_account: "ai.confirm.fields.from_account",
  to_account: "ai.confirm.fields.to_account",
  from_balance_after: "ai.confirm.fields.from_balance_after",
  to_balance_after: "ai.confirm.fields.to_balance_after",
  name: "ai.confirm.fields.name",
  kind: "ai.confirm.fields.kind",
  phone: "ai.confirm.fields.phone",
  email: "ai.confirm.fields.email",
  notes: "ai.confirm.fields.notes",
  plate: "ai.confirm.fields.plate",
  vehicle: "ai.confirm.fields.vehicle",
  services: "ai.confirm.fields.services",
  status_from: "ai.confirm.fields.status_from",
  status_to: "ai.confirm.fields.status_to",
  payment_status: "ai.confirm.fields.payment_status",
  items: "ai.confirm.fields.items",
  due: "ai.confirm.fields.due",
  assignee: "ai.confirm.fields.assignee",
  title: "ai.confirm.fields.title",
  due_date: "ai.confirm.fields.due_date",
  due_time: "ai.confirm.fields.due_time",
  amount: "ai.confirm.fields.amount",
};

const CONFIRM_WARNING_KEYS: Record<string, string> = {
  no_open_balance: "ai.confirm.warnings.no_open_balance",
  exceeds_balance: "ai.confirm.warnings.exceeds_balance",
  negative_balance: "ai.confirm.warnings.negative_balance",
  possible_duplicate: "ai.confirm.warnings.possible_duplicate",
  unpaid_delivery: "ai.confirm.warnings.unpaid_delivery",
};

const CONFIRM_STATUS_KEYS: Record<string, string> = {
  pending: "ai.confirm.status.pending",
  executing: "ai.confirm.status.executing",
  confirmed: "ai.confirm.status.confirmed",
  failed: "ai.confirm.status.failed",
  cancelled: "ai.confirm.status.cancelled",
  expired: "ai.confirm.status.expired",
};

const ACTION_ERROR_KEYS: Record<string, string> = {
  AI_ACTION_RESOLVED: "ai.confirm.errors.resolved",
  AI_ACTION_EXPIRED: "ai.confirm.errors.expired",
  AI_ACTION_NOT_READY: "ai.confirm.errors.not_ready",
  AI_ACTION_FORBIDDEN: "ai.confirm.errors.forbidden",
  VALIDATION_ERROR: "ai.confirm.errors.validation",
  RATE_LIMITED: "ai.errors.rate_limited",
};

export function confirmFieldKey(key: string) {
  return CONFIRM_FIELD_KEYS[key] ?? "ai.confirm.fields.other";
}

export function confirmWarningKey(key: string) {
  return CONFIRM_WARNING_KEYS[key] ?? "ai.confirm.warnings.generic";
}

export function confirmStatusKey(status: string) {
  return CONFIRM_STATUS_KEYS[status] ?? "ai.confirm.status.pending";
}

export function actionErrorKey(code?: string | null) {
  return (code && ACTION_ERROR_KEYS[code]) || "ai.confirm.errors.generic";
}

/** Backend value keys look like `ai.confirm.values.*`; accept only those. */
export function isConfirmValueKey(key?: string | null): key is string {
  return Boolean(key && /^ai\.confirm\.values\.[a-z_]+$/.test(key));
}
