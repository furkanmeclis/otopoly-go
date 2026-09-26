type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** Localized text for a quote delivery error (stable backend prefixes). */
export function deliveryErrorText(
  error: string | null | undefined,
  t: Translate,
) {
  const e = (error ?? "").trim();
  if (e === "not configured") return t("quotes.send.not_configured");
  if (e.startsWith("whatsapp_not_connected")) {
    return t("quotes.send.wa_not_connected");
  }
  if (e.startsWith("customer_no_phone")) return t("quotes.send.no_phone_error");
  return e;
}

export function isWhatsAppNotConnected(error: string | null | undefined) {
  return (error ?? "").startsWith("whatsapp_not_connected");
}
