import { platformRequest } from "@/api/client";
import { apiUrl, downloadAndShare } from "@/api/files";
import type {
  ConvertQuoteInput,
  PublicQuote,
  QuoteConvertPreview,
  QuoteConvertResult,
  QuoteDetail,
  QuoteListParams,
  QuotePage,
  QuoteReminderInput,
  QuoteSendPreview,
  QuoteSendResult,
  QuoteSummary,
  SaveQuoteInput,
  SendQuoteInput,
} from "@/features/quotes/types";

const base = "/v1/tenant/quotes";

export const quotesService = {
  list(params: QuoteListParams = {}) {
    return platformRequest<QuotePage>("GET", base, {
      query: { limit: 50, offset: 0, ...params },
    });
  },
  summary() {
    return platformRequest<QuoteSummary>("GET", `${base}/summary`);
  },
  get(uuid: string) {
    return platformRequest<QuoteDetail>("GET", `${base}/${uuid}`);
  },
  create(body: SaveQuoteInput) {
    return platformRequest<QuoteDetail>("POST", base, { body });
  },
  update(uuid: string, body: SaveQuoteInput) {
    return platformRequest<QuoteDetail>("PUT", `${base}/${uuid}`, { body });
  },
  duplicate(uuid: string) {
    return platformRequest<QuoteDetail>("POST", `${base}/${uuid}/duplicate`);
  },
  setStatus(uuid: string, status: string, note?: string) {
    return platformRequest<QuoteDetail>("POST", `${base}/${uuid}/status`, {
      body: { status, note },
    });
  },
  send(uuid: string, body: SendQuoteInput) {
    return platformRequest<QuoteSendResult>("POST", `${base}/${uuid}/send`, {
      body,
    });
  },
  sendPreview(uuid: string) {
    return platformRequest<QuoteSendPreview>(
      "GET",
      `${base}/${uuid}/send-preview`,
    );
  },
  retryDelivery(uuid: string, deliveryUuid: string) {
    return platformRequest<QuoteSendResult>(
      "POST",
      `${base}/${uuid}/deliveries/${deliveryUuid}/retry`,
    );
  },
  setReminders(uuid: string, reminders: QuoteReminderInput[]) {
    return platformRequest<QuoteDetail>("PUT", `${base}/${uuid}/reminders`, {
      body: { reminders },
    });
  },
  convertPreview(uuid: string) {
    return platformRequest<QuoteConvertPreview>(
      "GET",
      `${base}/${uuid}/convert`,
    );
  },
  convert(uuid: string, body: ConvertQuoteInput) {
    return platformRequest<QuoteConvertResult>(
      "POST",
      `${base}/${uuid}/convert`,
      { body },
    );
  },
  /** Downloads the PDF and opens the share sheet. */
  async downloadPdf(uuid: string, number: string) {
    return downloadAndShare(`${base}/${uuid}/pdf`, `${number}.pdf`);
  },
  previewUrl(uuid: string) {
    return apiUrl(`${base}/${uuid}/pdf?inline=1`);
  },
};

async function publicCall(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<PublicQuote> {
  const url = apiUrl(path);
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => undefined)) as
    { data?: PublicQuote; error?: { code?: string } } | undefined;
  if (!response.ok || !payload?.data) {
    const err = new Error(payload?.error?.code ?? `HTTP ${response.status}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }
  return payload.data;
}

/** Public share-link calls (no session; never emits global error toasts). */
export const publicQuotesService = {
  get(token: string) {
    return publicCall("GET", `/v1/public/quotes/${encodeURIComponent(token)}`);
  },
  decide(token: string, accept: boolean, note?: string) {
    return publicCall(
      "POST",
      `/v1/public/quotes/${encodeURIComponent(token)}/${accept ? "accept" : "reject"}`,
      { note: note ?? "" },
    );
  },
  pdfUrl(token: string) {
    return apiUrl(`/v1/public/quotes/${encodeURIComponent(token)}/pdf`);
  },
};
