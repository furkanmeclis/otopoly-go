import { apiUrl, platformFormRequest, type UploadFile } from "@/api/files";
import { platformRequest } from "@/api/client";
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
  reportPayment(uuid: string, file: UploadFile, note: string) {
    const form = new FormData();
    form.append("file", file as unknown as Blob);
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
    return apiUrl(`${base}/invoices/${uuid}/pdf`);
  },
  receiptUrl(uuid: string) {
    return apiUrl(`${base}/orders/${uuid}/receipt`);
  },
};
