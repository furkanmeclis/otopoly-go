/**
 * In-memory mock database. Rows use the same shapes the API returns (feature service types),
 * plus a few internal fields prefixed with `_`. Persisted to AsyncStorage so demo data survives reloads.
 */
import type { CariAccount, CariEntry } from '@/features/cari/services/cari.service';
import type {
  CatalogCategory,
  CatalogProduct,
  CatalogService,
} from '@/features/catalog/services/catalog.service';
import type { Customer, CustomerVehicle, VehicleCatalogOption } from '@/features/customers/services/customers.service';
import type { FinanceAccount, FinanceCategory, FinanceTransaction } from '@/features/finance/services/finance.service';
import type { JobDetail } from '@/features/jobs/services/jobs.service';
import type { LeadDetail } from '@/features/leads/types';
import type { PurchaseDetail } from '@/features/purchases/services/purchases.service';
import type { QuoteDetail } from '@/features/quotes/types';
import type { SaleDetail } from '@/features/sales/services/sales.service';
import type { Supplier } from '@/features/suppliers/services/suppliers.service';
import type { Todo } from '@/features/todos/types';
import { createLogger } from '@/lib/logger';
import { prefs, StorageKeys } from '@/lib/storage';

import type { MockMembership, MockUser } from './core';

const log = createLogger('mock.db');

/** Bump when the seed or row shapes change so stale persisted demo data is discarded. */
export const MOCK_DB_VERSION = 3;

export type MockOrganization = {
  uuid: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'suspended' | 'expired';
  access_ends_at: string | null;
  plan_code: string;
  logo_url: string | null;
  phone: string;
  email: string;
  address: string;
  city: string;
  district: string;
  created_at: string;
};

export type MockVehicle = CustomerVehicle & { customer_uuid: string };
export type MockServiceProduct = { service_uuid: string; product_uuid: string; qty: string };
export type MockRefreshSession = {
  uuid: string;
  token: string;
  userUuid: string;
  orgUuid: string | null;
  user_agent: string;
  ip_address: string;
  created_at: string;
  expires_at: string;
};

export type MockDb = {
  version: number;
  seededAt: string;
  organizations: MockOrganization[];
  users: MockUser[];
  memberships: MockMembership[];
  sessions: MockRefreshSession[];

  customers: Customer[];
  vehicles: MockVehicle[];
  vehicleCatalog: VehicleCatalogOption[];

  catalogCategories: CatalogCategory[];
  products: CatalogProduct[];
  services: CatalogService[];
  serviceProducts: MockServiceProduct[];

  financeAccounts: FinanceAccount[];
  financeCategories: FinanceCategory[];
  transactions: FinanceTransaction[];

  jobs: (JobDetail & { _org: string })[];
  cariAccounts: CariAccount[];
  cariEntries: CariEntry[];
  sales: SaleDetail[];
  suppliers: Supplier[];
  purchases: PurchaseDetail[];

  leads: LeadDetail[];
  quotes: QuoteDetail[];
  todos: Todo[];
};

let db: MockDb | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function getDb(): MockDb {
  if (!db) throw new Error('Mock DB not loaded');
  return db;
}

export function setDb(next: MockDb) {
  db = next;
}

/** Debounced persistence after every mutation. */
export function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!db) return;
    prefs.set(StorageKeys.demoMockDb, db).catch((error) => log.warn('Persist failed', error));
  }, 400);
}

export async function loadDb(seed: () => MockDb): Promise<MockDb> {
  const saved = await prefs.get<MockDb | null>(StorageKeys.demoMockDb, null);
  if (saved && saved.version === MOCK_DB_VERSION) {
    db = saved;
    log.info('Mock DB restored', { seededAt: saved.seededAt, jobs: saved.jobs.length });
    return db;
  }
  db = seed();
  log.info('Mock DB seeded', { jobs: db.jobs.length, customers: db.customers.length });
  persist();
  return db;
}

export async function resetDb(seed: () => MockDb) {
  db = seed();
  await prefs.set(StorageKeys.demoMockDb, db);
  log.info('Mock DB reset');
}
