/**
 * React Query hooks for every tenant module. Keys are namespaced per module so a mutation
 * can invalidate everything it may have changed (e.g. closing a job touches jobs, finance, cari, reports).
 */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import type { ListPage } from '@/api/types';
import { cariService } from '@/features/cari/services/cari.service';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { customersService } from '@/features/customers/services/customers.service';
import { financeService } from '@/features/finance/services/finance.service';
import { jobsService } from '@/features/jobs/services/jobs.service';
import { leadsService } from '@/features/leads/services/leads.service';
import type { LeadListParams } from '@/features/leads/types';
import { purchasesService } from '@/features/purchases/services/purchases.service';
import { quotesService } from '@/features/quotes/services/quotes.service';
import type { QuoteListParams } from '@/features/quotes/types';
import { reportsService, type ReportsOverviewFilters } from '@/features/reports/services/reports.service';
import { salesService } from '@/features/sales/services/sales.service';
import { staffService } from '@/features/staff/services/staff.service';
import { suppliersService } from '@/features/suppliers/services/suppliers.service';
import { todosService } from '@/features/todos/services/todos.service';
import type { TodoListParams } from '@/features/todos/types';

export const qk = {
  jobs: ['jobs'] as const,
  customers: ['customers'] as const,
  cari: ['cari'] as const,
  finance: ['finance'] as const,
  catalog: ['catalog'] as const,
  sales: ['sales'] as const,
  suppliers: ['suppliers'] as const,
  purchases: ['purchases'] as const,
  staff: ['staff'] as const,
  reports: ['reports'] as const,
  leads: ['leads'] as const,
  quotes: ['quotes'] as const,
  todos: ['todos'] as const,
  contracts: ['contracts'] as const,
  messaging: ['messaging'] as const,
  billing: ['billing'] as const,
  io: ['io'] as const,
  ai: ['ai'] as const,
  account: ['account'] as const,
  settings: ['settings'] as const,
  calendar: ['calendar'] as const,
  stockReorder: ['stock-reorder'] as const,
};

/** Everything money-related a document write can change. */
export const MONEY_KEYS = [qk.jobs, qk.finance, qk.cari, qk.reports, qk.sales, qk.purchases, qk.customers, qk.catalog, qk.stockReorder];

type Params = Record<string, string | number | undefined>;
const PAGE = 20;

/** Infinite list with `limit/offset` pagination (API_CONVENTIONS "Lists"). */
export function useInfiniteList<T>(key: readonly unknown[], fetchPage: (p: Params) => Promise<ListPage<T>>, params: Params, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: [...key, 'list', params],
    queryFn: ({ pageParam }) => fetchPage({ ...params, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    placeholderData: keepPreviousData,
    enabled,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  return { ...query, items, total };
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

export const useJobs = (params: Params, enabled = true) =>
  useQuery({ queryKey: [...qk.jobs, 'list', params], queryFn: () => jobsService.list(params as never), enabled, placeholderData: keepPreviousData });
export const useJobsInfinite = (params: Params) => useInfiniteList(qk.jobs, (p) => jobsService.list(p as never), params);
export const useJobsSummary = (date?: string, enabled = true) =>
  useQuery({ queryKey: [...qk.jobs, 'summary', date], queryFn: () => jobsService.summary(date), enabled });
export const useJob = (uuid: string) => useQuery({ queryKey: [...qk.jobs, 'detail', uuid], queryFn: () => jobsService.get(uuid), enabled: Boolean(uuid) });
export const useCustomerJobs = (uuid: string) =>
  useQuery({ queryKey: [...qk.jobs, 'by-customer', uuid], queryFn: () => jobsService.listByCustomer(uuid, { limit: 10, offset: 0 }), enabled: Boolean(uuid) });
/** Customer activity feed (customer, vehicles, jobs, sales, quotes, leads, cari, contracts), paged with "load more". */
export const useCustomerActivity = (uuid: string, enabled = true) =>
  useInfiniteList([...qk.customers, 'activity', uuid], (p) => customersService.activity(uuid, p as never), {}, enabled && Boolean(uuid));
export const useStaffOptions = (enabled = true) => useQuery({ queryKey: [...qk.staff, 'options'], queryFn: () => staffService.options(), enabled, staleTime: 5 * 60_000 });

// ─── Customers ─────────────────────────────────────────────────────────────

export const useCustomersInfinite = (params: Params) => useInfiniteList(qk.customers, (p) => customersService.list(p as never), params);
export const useCustomersSearch = (q: string, enabled = true) =>
  useQuery({
    queryKey: [...qk.customers, 'search', q],
    queryFn: () => customersService.list({ q, limit: 30, offset: 0, is_active: 'true' } as never),
    enabled,
    placeholderData: keepPreviousData,
  });
export const useCustomer = (uuid: string | null | undefined) =>
  useQuery({ queryKey: [...qk.customers, 'detail', uuid], queryFn: () => customersService.get(uuid!), enabled: Boolean(uuid) });
export const useVehicleCatalog = (q: string) =>
  useQuery({ queryKey: ['vehicle-catalog', q], queryFn: () => customersService.searchCatalog(q), placeholderData: keepPreviousData, staleTime: 10 * 60_000 });

// ─── Catalog ───────────────────────────────────────────────────────────────

export const useCatalogSummary = () => useQuery({ queryKey: [...qk.catalog, 'summary'], queryFn: () => catalogService.summary() });
export const useServices = (params: Params = {}) =>
  useQuery({ queryKey: [...qk.catalog, 'services', params], queryFn: () => catalogService.listServices({ limit: 100, offset: 0, ...params } as never) });
export const useServicesInfinite = (params: Params) => useInfiniteList([...qk.catalog, 'services'], (p) => catalogService.listServices(p as never), params);
export const useService = (uuid: string) => useQuery({ queryKey: [...qk.catalog, 'service', uuid], queryFn: () => catalogService.getService(uuid), enabled: Boolean(uuid) });
export const useServiceProducts = (uuid: string) =>
  useQuery({ queryKey: [...qk.catalog, 'service-products', uuid], queryFn: () => catalogService.listServiceProducts(uuid), enabled: Boolean(uuid) });
export const useProducts = (params: Params = {}) =>
  useQuery({ queryKey: [...qk.catalog, 'products', params], queryFn: () => catalogService.listProducts({ limit: 100, offset: 0, ...params } as never) });
export const useProductsInfinite = (params: Params) => useInfiniteList([...qk.catalog, 'products'], (p) => catalogService.listProducts(p as never), params);
export const useProduct = (uuid: string) => useQuery({ queryKey: [...qk.catalog, 'product', uuid], queryFn: () => catalogService.getProduct(uuid), enabled: Boolean(uuid) });
export const useCatalogCategories = (kind?: 'product' | 'service') =>
  useQuery({ queryKey: [...qk.catalog, 'categories', kind], queryFn: () => catalogService.listCategories(kind ? { kind } : undefined) });

// ─── Finance ───────────────────────────────────────────────────────────────

export const useFinanceSummary = (params: { date_from?: string; date_to?: string }) =>
  useQuery({ queryKey: [...qk.finance, 'summary', params], queryFn: () => financeService.summary(params), placeholderData: keepPreviousData });
export const useFinanceAccounts = (activeOnly = false) =>
  useQuery({
    queryKey: [...qk.finance, 'accounts', activeOnly],
    queryFn: () => financeService.listAccounts({ limit: 100, offset: 0, ...(activeOnly ? { is_active: 'true' } : {}) }),
  });
export const useFinanceAccountDetail = (uuid: string) =>
  useQuery({ queryKey: [...qk.finance, 'account', uuid], queryFn: () => financeService.getAccountDetail(uuid, { limit: 20 }), enabled: Boolean(uuid) });
export const useFinanceCategories = (kind?: 'income' | 'expense') =>
  useQuery({ queryKey: [...qk.finance, 'categories', kind], queryFn: () => financeService.listCategories(kind ? { kind } : undefined) });
export const useFinanceCategoryDetail = (uuid: string) =>
  useQuery({ queryKey: [...qk.finance, 'category', uuid], queryFn: () => financeService.getCategoryDetail(uuid, { limit: 20 }), enabled: Boolean(uuid) });
export const useTransactionsInfinite = (params: Params) => useInfiniteList([...qk.finance, 'transactions'], (p) => financeService.listTransactions(p as never), params);
export const useTransaction = (uuid: string) =>
  useQuery({ queryKey: [...qk.finance, 'transaction', uuid], queryFn: () => financeService.getTransaction(uuid), enabled: Boolean(uuid) });

// ─── Cari ──────────────────────────────────────────────────────────────────

export const useCariSummary = () => useQuery({ queryKey: [...qk.cari, 'summary'], queryFn: () => cariService.summary() });
export const useCariInfinite = (params: Params) => useInfiniteList(qk.cari, (p) => cariService.list(p as never), params);
export const useCariAccount = (uuid: string | null | undefined) =>
  useQuery({ queryKey: [...qk.cari, 'detail', uuid], queryFn: () => cariService.get(uuid!), enabled: Boolean(uuid) });
export const useCariEntriesInfinite = (uuid: string, params: Params) =>
  useInfiniteList([...qk.cari, 'entries', uuid], (p) => cariService.listEntries(uuid, p as never), params, Boolean(uuid));

// ─── Sales / suppliers / purchases ─────────────────────────────────────────

export const useSalesSummary = (date?: string) => useQuery({ queryKey: [...qk.sales, 'summary', date], queryFn: () => salesService.summary(date) });
export const useSalesInfinite = (params: Params) => useInfiniteList(qk.sales, (p) => salesService.list(p as never), params);
export const useSale = (uuid: string) => useQuery({ queryKey: [...qk.sales, 'detail', uuid], queryFn: () => salesService.get(uuid), enabled: Boolean(uuid) });
export const useSuppliersInfinite = (params: Params) => useInfiniteList(qk.suppliers, (p) => suppliersService.list(p as never), params);
export const useSuppliers = () =>
  useQuery({ queryKey: [...qk.suppliers, 'all'], queryFn: () => suppliersService.list({ limit: 100, offset: 0, is_active: 'true' }) });
export const useSupplier = (uuid: string) => useQuery({ queryKey: [...qk.suppliers, 'detail', uuid], queryFn: () => suppliersService.get(uuid), enabled: Boolean(uuid) });
export const usePurchasesInfinite = (params: Params) => useInfiniteList(qk.purchases, (p) => purchasesService.list(p as never), params);
export const usePurchase = (uuid: string) => useQuery({ queryKey: [...qk.purchases, 'detail', uuid], queryFn: () => purchasesService.get(uuid), enabled: Boolean(uuid) });
/** Recent sales of one customer (`customer_uuid` filter, newest first). */
export const useCustomerSales = (customerUuid: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: [...qk.sales, 'by-customer', customerUuid],
    queryFn: () => salesService.list({ customer_uuid: customerUuid!, limit: 10, offset: 0 }),
    enabled: enabled && Boolean(customerUuid),
  });
/** Recent purchases from one supplier (`supplier_uuid` filter, newest first); `status` narrows it (e.g. posted for totals). */
export const useSupplierPurchases = (supplierUuid: string | null | undefined, enabled = true, opts: { status?: 'posted' | 'voided'; limit?: number } = {}) =>
  useQuery({
    queryKey: [...qk.purchases, 'by-supplier', supplierUuid, opts],
    queryFn: () => purchasesService.list({ supplier_uuid: supplierUuid!, status: opts.status, limit: opts.limit ?? 10, offset: 0 }),
    enabled: enabled && Boolean(supplierUuid),
  });

// ─── Staff / reports ───────────────────────────────────────────────────────

export const useStaff = () => useQuery({ queryKey: [...qk.staff, 'list'], queryFn: () => staffService.list() });
export const useReportsOverview = (filters: ReportsOverviewFilters, enabled = true) =>
  useQuery({ queryKey: [...qk.reports, 'overview', filters], queryFn: () => reportsService.overview(filters), enabled, placeholderData: keepPreviousData });

// ─── CRM ───────────────────────────────────────────────────────────────────

export const useLeadsSummary = (enabled = true) => useQuery({ queryKey: [...qk.leads, 'summary'], queryFn: () => leadsService.summary(), enabled });
export const useLeads = (params: LeadListParams, enabled = true) =>
  useQuery({ queryKey: [...qk.leads, 'list', params], queryFn: () => leadsService.list(params), enabled, placeholderData: keepPreviousData });
export const useLead = (uuid: string) => useQuery({ queryKey: [...qk.leads, 'detail', uuid], queryFn: () => leadsService.get(uuid), enabled: Boolean(uuid) });
export const useLeadAssignees = () => useQuery({ queryKey: [...qk.leads, 'assignees'], queryFn: () => leadsService.assignees(), staleTime: 5 * 60_000 });
export const useQuotesSummary = (enabled = true) => useQuery({ queryKey: [...qk.quotes, 'summary'], queryFn: () => quotesService.summary(), enabled });
export const useQuotes = (params: QuoteListParams, enabled = true) =>
  useQuery({ queryKey: [...qk.quotes, 'list', params], queryFn: () => quotesService.list(params), enabled, placeholderData: keepPreviousData });
export const useQuote = (uuid: string) => useQuery({ queryKey: [...qk.quotes, 'detail', uuid], queryFn: () => quotesService.get(uuid), enabled: Boolean(uuid) });
export const useQuoteConvertPreview = (uuid: string, enabled: boolean) =>
  useQuery({ queryKey: [...qk.quotes, 'convert', uuid], queryFn: () => quotesService.convertPreview(uuid), enabled });
export const useTodosSummary = (enabled = true) => useQuery({ queryKey: [...qk.todos, 'summary'], queryFn: () => todosService.summary(), enabled });
export const useTodos = (params: TodoListParams, enabled = true) =>
  useQuery({ queryKey: [...qk.todos, 'list', params], queryFn: () => todosService.list(params), enabled, placeholderData: keepPreviousData });
export const useTodoAssignees = () => useQuery({ queryKey: [...qk.todos, 'assignees'], queryFn: () => todosService.assignees(), staleTime: 5 * 60_000 });
