import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type JobStatus =
  "in_progress" | "ready" | "delivered" | "cancelled" | "voided";

export type PaymentStatus = "unpaid" | "paid";

export type JobLine = {
  uuid: string;
  line_type: string;
  service_uuid?: string | null;
  name: string;
  unit_price: string;
  qty: string;
  vat_rate: string;
  line_total: string;
  currency: string;
  sort_order: number;
};

export type JobPayment = {
  uuid: string;
  method: "cash" | "card" | "cari";
  amount: string;
  currency: string;
  status: "posted" | "void";
  finance_account_uuid?: string | null;
  finance_account_name?: string | null;
  finance_transaction_uuid?: string | null;
  cari_entry_uuid?: string | null;
  created_at: string;
  voided_at?: string | null;
};

export type Job = {
  uuid: string;
  customer_uuid: string;
  vehicle_uuid: string;
  customer_name: string;
  customer_phone: string;
  plate: string;
  vehicle_label: string;
  status: JobStatus;
  payment_status: PaymentStatus;
  currency: string;
  notes: string;
  total_amount: string;
  assignee_uuid?: string | null;
  assignee_name?: string;
  /** List rows only: vehicle brand for the board card mark. */
  brand_name?: string;
  brand_logo_url?: string | null;
  started_at: string;
  completed_at?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type JobDetail = Job & {
  lines: JobLine[];
  payments: JobPayment[];
};

export type JobsSummary = {
  job_count: number;
  card_total: string;
  cari_total: string;
  net_total: string;
  paid_total: string;
  date: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateJobInput = {
  customer_uuid: string;
  vehicle_uuid: string;
  assignee_uuid?: string;
  notes?: string;
  started_at?: string;
  currency?: string;
  lines: Array<{
    service_uuid: string;
    unit_price?: string;
    qty?: string;
  }>;
};

export type CloseJobInput = {
  method: "cash" | "card" | "cari";
  finance_account_uuid?: string;
};

export const jobsService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/jobs/meta");
  },
  summary(date?: string) {
    return platformRequest<JobsSummary>("GET", "/v1/tenant/jobs/summary", {
      query: date ? { date } : undefined,
    });
  },
  list(
    params?: ServerListParams & {
      status?: string;
      date_from?: string;
      date_to?: string;
      /** Also return unfinished jobs opened before date_from. */
      include_open?: string;
    },
  ) {
    return platformRequest<ListPage<Job>>("GET", "/v1/tenant/jobs", {
      query: params,
    });
  },
  get(uuid: string) {
    return platformRequest<JobDetail>("GET", `/v1/tenant/jobs/${uuid}`);
  },
  create(body: CreateJobInput) {
    return platformRequest<JobDetail>("POST", "/v1/tenant/jobs", { body });
  },
  patch(uuid: string, body: { notes?: string; assignee_uuid?: string | null }) {
    return platformRequest<JobDetail>("PATCH", `/v1/tenant/jobs/${uuid}`, {
      body,
    });
  },
  ready(uuid: string) {
    return platformRequest<JobDetail>("POST", `/v1/tenant/jobs/${uuid}/ready`);
  },
  done(uuid: string) {
    return platformRequest<JobDetail>("POST", `/v1/tenant/jobs/${uuid}/done`);
  },
  deliver(uuid: string) {
    return platformRequest<JobDetail>(
      "POST",
      `/v1/tenant/jobs/${uuid}/deliver`,
    );
  },
  close(uuid: string, body: CloseJobInput) {
    return platformRequest<JobDetail>("POST", `/v1/tenant/jobs/${uuid}/close`, {
      body,
    });
  },
  cancel(uuid: string) {
    return platformRequest<JobDetail>("POST", `/v1/tenant/jobs/${uuid}/cancel`);
  },
  void(uuid: string) {
    return platformRequest<JobDetail>("POST", `/v1/tenant/jobs/${uuid}/void`);
  },
  listByCustomer(customerUuid: string, params?: ServerListParams) {
    return platformRequest<ListPage<Job>>(
      "GET",
      `/v1/tenant/customers/${customerUuid}/jobs`,
      { query: params },
    );
  },
};
