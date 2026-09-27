import { apiConfig } from "@/config/api";
import { platformFormRequest } from "@/lib/api/platform-form-request";
import { platformRequest } from "@/lib/api/platform-request";
import type {
  BillingInvoice,
  BillingOrder,
  InvoiceProfile,
  BillingOverview,
  BillingPlan,
  ListResult,
  OrderPreview,
  OrderPreviewInput,
} from "@/features/billing/types";

const base = "/v1/tenant/billing";

export const billingService = {
  overview() {
    return platformRequest<BillingOverview>("GET", `${base}/overview`);
  },
  plans() {
    return platformRequest<BillingPlan[]>("GET", `${base}/plans`);
  },
  preview(body: OrderPreviewInput) {
    return platformRequest<OrderPreview>("POST", `${base}/orders/preview`, {
      body,
    });
  },
  createOrder(body: OrderPreviewInput) {
    return platformRequest<BillingOrder>("POST", `${base}/orders`, { body });
  },
  orders(status: "open" | "all" = "all", limit = 20) {
    return platformRequest<ListResult<BillingOrder>>("GET", `${base}/orders`, {
      query: { status, limit },
    });
  },
  order(uuid: string) {
    return platformRequest<BillingOrder>("GET", `${base}/orders/${uuid}`);
  },
  reportPayment(uuid: string, file: File, note: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("note", note);
    return platformFormRequest<BillingOrder>(
      "POST",
      `${base}/orders/${uuid}/report`,
      form,
    );
  },
  cancelOrder(uuid: string) {
    return platformRequest<BillingOrder>(
      "POST",
      `${base}/orders/${uuid}/cancel`,
    );
  },
  invoiceProfile() {
    return platformRequest<InvoiceProfile>("GET", `${base}/invoice-profile`);
  },
  updateInvoiceProfile(body: InvoiceProfile) {
    return platformRequest<InvoiceProfile>("PUT", `${base}/invoice-profile`, {
      body,
    });
  },
  invoices(limit = 50) {
    return platformRequest<ListResult<BillingInvoice>>(
      "GET",
      `${base}/invoices`,
      { query: { limit } },
    );
  },
  invoicePdfUrl(uuid: string) {
    return `${apiConfig.baseUrl.replace(/\/$/, "")}${base}/invoices/${uuid}/pdf`;
  },
  receiptUrl(uuid: string) {
    return `${apiConfig.baseUrl.replace(/\/$/, "")}${base}/orders/${uuid}/receipt`;
  },
};
