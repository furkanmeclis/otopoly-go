import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type ReportsOverviewFilters = {
  date_from?: string;
  date_to?: string;
  currency?: string;
  payment_method?: string;
  account_uuid?: string;
  source_type?: string;
  granularity?: string;
};

export type ReportsNamedTotal = {
  key?: string;
  name: string;
  total: string;
  count: number;
  qty?: string;
};

export type ReportsSourceTotal = {
  source_type: string;
  type: string;
  total: string;
  count: number;
};

export type ReportsTimeseriesPoint = {
  date: string;
  income: string;
  expense: string;
  net: string;
  job_paid: string;
  job_count: number;
};

export type ReportsCariReceivable = {
  account_uuid: string;
  customer_uuid: string;
  customer_name: string;
  customer_phone: string;
  currency: string;
  balance: string;
  last_entry_date?: string | null;
};

export type ReportsTopCustomer = {
  customer_uuid: string;
  customer_name: string;
  job_total: string;
  job_count: number;
};

export type ReportsKPIs = {
  total_income: string;
  total_expense: string;
  net_profit: string;
  income_count: number;
  expense_count: number;
  job_count: number;
  job_paid_count: number;
  job_done_count: number;
  job_in_progress_count: number;
  job_cancelled_count: number;
  job_paid_total: string;
  avg_ticket: string;
  vehicles_served: number;
  sale_count: number;
  sale_total: string;
  purchase_count: number;
  purchase_total: string;
  cari_charged: string;
  cari_collected: string;
  cari_outstanding: string;
  cari_charge_count: number;
  cari_payment_count: number;
  cash_total: string;
  card_total: string;
  cari_payment_total: string;
};

export type ReportsOverview = {
  filters: {
    date_from: string;
    date_to: string;
    currency?: string | null;
    payment_method?: string | null;
    account_uuid?: string | null;
    source_type?: string | null;
    granularity: string;
  };
  kpis: ReportsKPIs;
  timeseries: ReportsTimeseriesPoint[];
  services: ReportsNamedTotal[];
  products: ReportsNamedTotal[];
  expenses_by_category: ReportsNamedTotal[];
  income_by_category: ReportsNamedTotal[];
  payments_by_method: ReportsNamedTotal[];
  revenue_by_source: ReportsSourceTotal[];
  cari_receivables: ReportsCariReceivable[];
  top_customers: ReportsTopCustomer[];
  generated_at: string;
};

function cleanParams(params?: ReportsOverviewFilters) {
  if (!params) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      out[k] = String(v);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export const reportsService = {
  meta: () => platformRequest<ResourceMeta>("GET", "/v1/tenant/reports/meta"),
  overview: (params?: ReportsOverviewFilters) =>
    platformRequest<ReportsOverview>("GET", "/v1/tenant/reports/overview", {
      query: cleanParams(params),
    }),
};
