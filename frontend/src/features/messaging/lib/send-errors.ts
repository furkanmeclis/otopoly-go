type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Classified WhatsApp send failures (`outbound_messages.error_code`, and the
 * upper-cased 409 codes of the platform test endpoint) → i18n keys.
 */
const SEND_ERROR_KEYS: Record<string, string> = {
  feature_not_entitled: "messaging.errors.feature_not_entitled",
  quota_exceeded: "messaging.errors.quota_exceeded",
  own_session_disconnected: "messaging.errors.own_session_disconnected",
  platform_sender_not_configured:
    "messaging.errors.platform_sender_not_configured",
  platform_sender_unavailable: "messaging.errors.platform_sender_unavailable",
  template_not_approved: "messaging.errors.template_not_approved",
  cloud_auth_failed: "messaging.errors.cloud_auth_failed",
  cloud_unavailable: "messaging.errors.cloud_unavailable",
  rate_limited: "messaging.errors.rate_limited",
  marketing_limit: "messaging.errors.marketing_limit",
  undeliverable: "messaging.errors.undeliverable",
  template_missing: "messaging.errors.template_missing",
  template_param_mismatch: "messaging.errors.template_param_mismatch",
  invalid_recipient: "messaging.errors.invalid_recipient",
  media_upload_failed: "messaging.errors.media_upload_failed",
  send_failed: "messaging.errors.send_failed",
};

/** True for classified send codes (incl. `graph_<n>`), case-insensitive. */
export function isSendErrorCode(code?: string | null): boolean {
  const normalized = (code ?? "").trim().toLowerCase();
  return (
    Object.hasOwn(SEND_ERROR_KEYS, normalized) || /^graph_\d+$/.test(normalized)
  );
}

/** Human label for a classified send error code (case-insensitive). */
export function sendErrorLabel(t: Translate, code?: string | null): string {
  const normalized = (code ?? "").trim().toLowerCase();
  if (!normalized) return "";
  const key = Object.hasOwn(SEND_ERROR_KEYS, normalized)
    ? SEND_ERROR_KEYS[normalized]
    : undefined;
  if (key) return t(key);
  const graph = /^graph_(\d+)$/.exec(normalized);
  if (graph) return t("messaging.errors.graph", { code: graph[1] });
  return t("messaging.errors.unknown", { code: normalized });
}
