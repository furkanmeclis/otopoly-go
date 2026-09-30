/** Static i18n key maps (no dynamic `t()` keys), same as web `features/ai/lib/labels.ts`. */

const TOOL_LABEL_KEYS: Record<string, string> = {
  search_customers: 'ai.tools.search_customers',
  get_customer_account: 'ai.tools.get_customer_account',
  list_jobs: 'ai.tools.list_jobs',
  get_report_summary: 'ai.tools.get_report_summary',
  get_finance_balances: 'ai.tools.get_finance_balances',
  get_sales_summary: 'ai.tools.get_sales_summary',
  search_products: 'ai.tools.search_products',
  render_chart: 'ai.tools.render_chart',
};

const UNAVAILABLE_KEYS: Record<string, string> = {
  disabled: 'ai.unavailable.disabled',
  not_configured: 'ai.unavailable.not_configured',
  org_disabled: 'ai.unavailable.org_disabled',
  quota_exceeded: 'ai.unavailable.quota_exceeded',
};

const ERROR_KEYS: Record<string, string> = {
  provider_error: 'ai.errors.provider_error',
  quota_exceeded: 'ai.errors.quota_exceeded',
  refusal: 'ai.errors.refusal',
  max_tokens: 'ai.errors.max_tokens',
  internal_error: 'ai.errors.internal_error',
  network: 'ai.errors.network',
  NETWORK_ERROR: 'ai.errors.network',
  TIMEOUT: 'ai.errors.network',
  AI_QUOTA_EXCEEDED: 'ai.errors.quota_exceeded',
  AI_DISABLED: 'ai.unavailable.disabled',
  AI_NOT_CONFIGURED: 'ai.unavailable.not_configured',
  AI_ORG_DISABLED: 'ai.unavailable.org_disabled',
  AI_CONVERSATION_LIMIT: 'ai.errors.conversation_limit',
  RATE_LIMITED: 'ai.errors.rate_limited',
};

export const toolLabelKey = (name: string) => TOOL_LABEL_KEYS[name] ?? 'ai.tools.unknown';
export const unavailableKey = (reason?: string | null) => (reason && UNAVAILABLE_KEYS[reason]) || 'ai.unavailable.title';
export const errorKey = (code?: string | null) => (code && ERROR_KEYS[code]) || 'ai.errors.generic';

/** Backend summary keys look like `ai.tool_summary.*`; accept only those. */
export function isSummaryKey(key?: string | null): key is string {
  return Boolean(key && /^ai\.tool_summary\.[a-z_]+$/.test(key));
}

/** Same suggestion chips as the web empty state. */
export const SUGGESTION_KEYS = [
  'ai.suggestions.delivered_today',
  'ai.suggestions.revenue_chart',
  'ai.suggestions.receivables',
  'ai.suggestions.cash',
  'ai.suggestions.low_stock',
] as const;
