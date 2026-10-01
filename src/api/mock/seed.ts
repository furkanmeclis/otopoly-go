/**
 * Deterministic demo data for a Turkish car-wash / detailing business.
 * 90 days of history relative to "now" so dashboards, reports and today's board look alive.
 */
import type { CatalogProduct, CatalogService } from '@/features/catalog/services/catalog.service';
import type { Customer, VehicleCatalogOption } from '@/features/customers/services/customers.service';
import type { JobDetail, JobLine } from '@/features/jobs/services/jobs.service';
import type { LeadDetail, LeadSource } from '@/features/leads/types';
import type { PurchaseDetail } from '@/features/purchases/services/purchases.service';
import type { SaleDetail } from '@/features/sales/services/sales.service';
import type { Todo } from '@/features/todos/types';

import { istanbulDay, money, type MockUser } from './core';
import { MOCK_DB_VERSION, setDb, type MockDb, type MockVehicle } from './db';
import { saveQuote } from './handlers/crm';
import {
  categoryByName,
  chargeFromSource,
  defaultAccount,
  FIN_CAT,
  moveStock,
  postCari,
  postFinance,
  cariAccountFor,
} from './ops';

// ─── Deterministic randomness ──────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(20260930);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
let idSeq = 0;
/** Stable pseudo-UUIDs so persisted data and deep links stay valid across reseeds. */
function sid(prefix: string) {
  idSeq += 1;
  const hex = (idSeq + prefix.length * 7919).toString(16).padStart(12, '0');
  const p = prefix.padEnd(8, '0').slice(0, 8).replace(/[^0-9a-f]/g, 'a');
  return `${p}-0000-4000-8000-${hex}`;
}

// ─── Reference data ────────────────────────────────────────────────────────

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_OWNER_EMAIL = 'demo@otopoly.com';
export const DEMO_STAFF_EMAIL = 'personel@otopoly.com';

const FIRST = ['Mehmet', 'Ayşe', 'Mustafa', 'Fatma', 'Emre', 'Zeynep', 'Burak', 'Elif', 'Can', 'Selin', 'Oğuz', 'Deniz', 'Kerem', 'Ece', 'Hakan', 'Büşra', 'Serkan', 'Gizem', 'Tolga', 'Merve', 'Onur', 'Esra', 'Barış', 'Cansu', 'Umut', 'Sibel', 'Volkan', 'Pınar', 'Cem', 'Derya'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Koç', 'Kurt', 'Özdemir', 'Polat', 'Erdoğan', 'Güneş', 'Aksoy'];
const COMPANIES = ['Anadolu Lojistik A.Ş.', 'Marmara Filo Kiralama', 'Ege Rent a Car', 'Boğaziçi Transfer Ltd.', 'Kuzey Kurye Hizmetleri'];

const CATALOG: [string, string, number[]][] = [
  ['BMW', '3 Serisi', [2018, 2020, 2022]],
  ['BMW', '5 Serisi', [2019, 2021, 2023]],
  ['Mercedes-Benz', 'C Serisi', [2017, 2020, 2022]],
  ['Mercedes-Benz', 'E Serisi', [2019, 2022]],
  ['Audi', 'A3', [2018, 2021]],
  ['Audi', 'A4', [2019, 2022]],
  ['Volkswagen', 'Passat', [2016, 2019, 2021]],
  ['Volkswagen', 'Golf', [2017, 2020, 2023]],
  ['Renault', 'Clio', [2018, 2021, 2023]],
  ['Renault', 'Megane', [2017, 2020]],
  ['Fiat', 'Egea', [2019, 2021, 2024]],
  ['Toyota', 'Corolla', [2018, 2021, 2024]],
  ['Toyota', 'C-HR', [2020, 2023]],
  ['Hyundai', 'i20', [2019, 2022]],
  ['Hyundai', 'Tucson', [2021, 2024]],
  ['Ford', 'Focus', [2017, 2020]],
  ['Ford', 'Kuga', [2020, 2023]],
  ['Honda', 'Civic', [2018, 2022]],
  ['Peugeot', '3008', [2019, 2022, 2024]],
  ['Tesla', 'Model Y', [2023, 2024]],
  ['Togg', 'T10X', [2023, 2024, 2025]],
  ['Dacia', 'Duster', [2019, 2022]],
];
const CITY_CODES = ['34', '34', '34', '06', '35', '16', '41', '07'];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';

function plate() {
  const letters = Array.from({ length: int(1, 3) }, () => LETTERS[int(0, LETTERS.length - 1)]).join('');
  return `${pick(CITY_CODES)} ${letters} ${int(10, 9999)}`;
}

const phone = () => `05${pick(['32', '33', '35', '42', '44', '52', '53', '55'])} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`;

/**
 * Istanbul wall-clock time `daysAgo` days back. The API buckets days in Europe/Istanbul (UTC+3, no DST),
 * so seeding in the process time zone would leave "today" empty on a UTC machine between 21:00 and 24:00.
 */
function at(daysAgo: number, hour: number, minute = 0) {
  const [y, m, d] = istanbulDay().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysAgo, hour - 3, minute, int(0, 59)));
}

// ─── Seed ──────────────────────────────────────────────────────────────────

export function seedDb(): MockDb {
  rand = mulberry32(20260930);
  idSeq = 0;
  const created = at(120, 9).toISOString();

  const org = {
    uuid: sid('0a9'),
    slug: 'parlak-oto',
    name: 'Parlak Oto Yıkama & Detailing',
    status: 'active' as const,
    access_ends_at: at(-18, 23, 59).toISOString(),
    plan_code: 'trial',
    logo_url: null,
    phone: '0216 555 12 34',
    email: 'info@parlakoto.com',
    address: 'Bağdat Cad. No: 214',
    city: 'İstanbul',
    district: 'Kadıköy',
    created_at: created,
  };

  const mkUser = (name: string, surname: string, email: string, roles: string[]): MockUser => ({
    uuid: sid('05e'),
    email,
    password: DEMO_PASSWORD,
    name,
    surname,
    locale: 'tr',
    status: 'active',
    roles,
    totpEnabled: false,
    created_at: created,
  });
  const owner = mkUser('Ahmet', 'Yılmaz', DEMO_OWNER_EMAIL, ['organization_user', 'organization_owner']);
  const staff1 = mkUser('Mehmet', 'Kaya', DEMO_STAFF_EMAIL, ['organization_user']);
  const staff2 = mkUser('Ali', 'Demir', 'ali@parlakoto.com', ['organization_user']);
  const staff3 = mkUser('Hasan', 'Çelik', 'hasan@parlakoto.com', ['organization_user']);
  staff3.status = 'inactive';
  const users = [owner, staff1, staff2, staff3];
  const workers = [owner, staff1, staff2];

  const db: MockDb = {
    version: MOCK_DB_VERSION,
    seededAt: new Date().toISOString(),
    organizations: [org],
    users,
    memberships: [
      { userUuid: owner.uuid, orgUuid: org.uuid, role: 'owner' },
      { userUuid: staff1.uuid, orgUuid: org.uuid, role: 'staff' },
      { userUuid: staff2.uuid, orgUuid: org.uuid, role: 'staff' },
      { userUuid: staff3.uuid, orgUuid: org.uuid, role: 'staff' },
    ],
    sessions: [],
    customers: [],
    vehicles: [],
    vehicleCatalog: [],
    catalogCategories: [],
    products: [],
    services: [],
    serviceProducts: [],
    financeAccounts: [],
    financeCategories: [],
    transactions: [],
    jobs: [],
    cariAccounts: [],
    cariEntries: [],
    sales: [],
    suppliers: [],
    purchases: [],
    leads: [],
    quotes: [],
    todos: [],
  };

  // Vehicle catalog
  const brandUuid = new Map<string, string>();
  for (const [brand, model, years] of CATALOG) {
    if (!brandUuid.has(brand)) brandUuid.set(brand, sid('b4a'));
    const modelUuid = sid('30d');
    for (const year of years) {
      db.vehicleCatalog.push({
        brand_uuid: brandUuid.get(brand)!,
        brand_name: brand,
        logo_url: null,
        model_uuid: modelUuid,
        model_name: model,
        year,
      } satisfies VehicleCatalogOption);
    }
  }

  // Catalog categories
  const mkCat = (name: string, kind: 'product' | 'service', sort: number) => {
    const c = {
      uuid: sid('ca7'),
      name,
      kind,
      parent_uuid: null,
      parent_name: null,
      sort_order: sort,
      is_active: true,
      created_at: created,
      updated_at: created,
    };
    db.catalogCategories.push(c);
    return c;
  };
  const catWash = mkCat('Yıkama', 'service', 1);
  const catDetail = mkCat('Detailing', 'service', 2);
  const catCoat = mkCat('Kaplama', 'service', 3);
  const catChem = mkCat('Kimyasallar', 'product', 1);
  const catCare = mkCat('Bakım Ürünleri', 'product', 2);
  const catAcc = mkCat('Aksesuar', 'product', 3);

  // Services
  const mkService = (name: string, cat: typeof catWash, price: number, minutes: number, color: string, code: string) => {
    const s: CatalogService = {
      uuid: sid('5e7'),
      name,
      category_uuid: cat.uuid,
      category_name: cat.name,
      code,
      duration_minutes: minutes,
      price: money(price),
      vat_rate: '20',
      currency: 'TRY',
      is_active: true,
      description: '',
      color,
      created_at: created,
      updated_at: created,
    };
    db.services.push(s);
    return s;
  };
  const sExterior = mkService('Dış Yıkama', catWash, 250, 20, 'sky', 'YKM-01');
  const sFull = mkService('İç-Dış Yıkama', catWash, 450, 40, 'emerald', 'YKM-02');
  const sInterior = mkService('Detaylı İç Temizlik', catDetail, 1400, 120, 'violet', 'DTL-01');
  const sEngine = mkService('Motor Yıkama', catWash, 600, 30, 'amber', 'YKM-03');
  const sSeats = mkService('Koltuk Yıkama', catDetail, 900, 90, 'teal', 'DTL-02');
  const sPolish = mkService('Pasta Cila', catDetail, 2100, 180, 'orange', 'DTL-03');
  const sCeramic = mkService('Seramik Kaplama', catCoat, 4250, 300, 'indigo', 'KPL-01');
  const sPpf = mkService('PPF Kaplama', catCoat, 38000, 960, 'rose', 'KPL-02');
  const sHeadlight = mkService('Far Temizliği', catDetail, 500, 30, 'cyan', 'DTL-04');
  const sOzone = mkService('Ozon Dezenfeksiyon', catDetail, 350, 25, 'lime', 'DTL-05');
  const sOld = mkService('Kış Paketi (eski)', catWash, 700, 60, 'slate', 'YKM-99');
  sOld.is_active = false;
  const serviceWeights: [CatalogService, number][] = [
    [sExterior, 30],
    [sFull, 34],
    [sInterior, 8],
    [sEngine, 6],
    [sSeats, 5],
    [sPolish, 6],
    [sCeramic, 3],
    [sPpf, 0.4],
    [sHeadlight, 4],
    [sOzone, 5],
  ];
  const totalWeight = serviceWeights.reduce((s, [, w]) => s + w, 0);
  const weightedService = () => {
    let r = rand() * totalWeight;
    for (const [s, w] of serviceWeights) {
      if ((r -= w) <= 0) return s;
    }
    return sFull;
  };

  // Products
  const mkProduct = (
    name: string,
    cat: typeof catChem,
    unit: string,
    cost: number,
    sale: number,
    stock: number,
    min: number,
    sku: string,
    track = true,
  ) => {
    const p: CatalogProduct = {
      uuid: sid('9d0'),
      name,
      category_uuid: cat.uuid,
      category_name: cat.name,
      sku,
      barcode: `869${int(1000000000, 9999999999)}`,
      unit,
      cost_price: money(cost),
      sale_price: money(sale),
      vat_rate: '20',
      currency: 'TRY',
      stock_quantity: String(stock),
      min_stock_alert: String(min),
      track_stock: track,
      stock_status: !track ? 'untracked' : stock <= 0 ? 'out_of_stock' : stock <= min ? 'low_stock' : 'in_stock',
      is_active: true,
      description: '',
      created_at: created,
      updated_at: created,
    };
    db.products.push(p);
    return p;
  };
  const pShampoo = mkProduct('Köpük Şampuan 20L', catChem, 'liter', 18, 0, 140, 40, 'KMY-001');
  const pWax = mkProduct('Sıvı Cila 5L', catChem, 'liter', 95, 0, 22, 10, 'KMY-002');
  const pInterior = mkProduct('İç Temizlik Spreyi', catChem, 'liter', 60, 0, 18, 8, 'KMY-003');
  const pCeramicKit = mkProduct('Seramik Kaplama Kiti', catChem, 'set', 1350, 0, 4, 3, 'KMY-004');
  const pTire = mkProduct('Lastik Parlatıcı', catCare, 'piece', 85, 190, 26, 10, 'BKM-001');
  const pFreshener = mkProduct('Oto Kokusu', catCare, 'piece', 35, 120, 64, 20, 'BKM-002');
  const pMicro = mkProduct('Mikrofiber Bez (3lü)', catAcc, 'set', 55, 150, 7, 10, 'AKS-001');
  const pGlass = mkProduct('Cam Suyu 3L', catCare, 'piece', 45, 110, 0, 12, 'BKM-003');
  const pMat = mkProduct('Paspas Seti', catAcc, 'set', 280, 650, 11, 4, 'AKS-002');
  const pWiper = mkProduct('Silecek Takımı', catAcc, 'set', 210, 420, 9, 4, 'AKS-003');
  mkProduct('Hediye Çeki', catAcc, 'piece', 0, 500, 0, 0, 'HDY-001', false);
  const sellable = [pTire, pFreshener, pMicro, pMat, pWiper, pGlass];

  // Recipes (service → products)
  const recipe = (s: CatalogService, p: CatalogProduct, qty: string) =>
    db.serviceProducts.push({ service_uuid: s.uuid, product_uuid: p.uuid, qty });
  recipe(sExterior, pShampoo, '0.5');
  recipe(sFull, pShampoo, '0.6');
  recipe(sFull, pInterior, '0.1');
  recipe(sInterior, pInterior, '0.4');
  recipe(sPolish, pWax, '0.3');
  recipe(sCeramic, pCeramicKit, '1');

  // Finance
  const mkAccount = (name: string, type: 'cash' | 'bank', opening: number, isDefault: boolean, bank?: string, iban?: string) => {
    const a = {
      uuid: sid('acc'),
      name,
      type,
      currency: 'TRY',
      opening_balance: money(opening),
      current_balance: money(opening),
      is_default: isDefault,
      is_active: true,
      bank_name: bank ?? null,
      iban: iban ?? null,
      notes: '',
      negative_balance: false,
      created_at: created,
      updated_at: created,
    };
    db.financeAccounts.push(a);
    return a;
  };
  const cash = mkAccount('Kasa', 'cash', 5000, true);
  const bank = mkAccount('İş Bankası POS', 'bank', 42000, true, 'Türkiye İş Bankası', 'TR12 0006 4000 0011 2345 6789 01');
  mkAccount('Garanti Ticari', 'bank', 18500, false, 'Garanti BBVA', 'TR45 0006 2000 4440 0006 2987 55');

  for (const name of [FIN_CAT.serviceIncome, FIN_CAT.productSale, FIN_CAT.cariCollection, 'Diğer Gelir']) categoryByName(db, name, 'income');
  const expenseNames = ['Kira', 'Elektrik', 'Su', 'Personel Maaşı', FIN_CAT.stockPurchase, 'Kimyasal / Sarf', 'Vergi & SGK', 'Diğer Gider'];
  for (const name of expenseNames) categoryByName(db, name, 'expense');
  const catService = categoryByName(db, FIN_CAT.serviceIncome, 'income');
  const catSale = categoryByName(db, FIN_CAT.productSale, 'income');
  const catCollect = categoryByName(db, FIN_CAT.cariCollection, 'income');
  const catStock = categoryByName(db, FIN_CAT.stockPurchase, 'expense');

  // Customers + vehicles
  const mkCustomer = (name: string, kind: 'individual' | 'company', daysAgo: number): Customer => {
    const c: Customer = {
      uuid: sid('c05'),
      name,
      phone: phone(),
      email: chance(0.5) ? `${name.split(' ')[0].toLocaleLowerCase('tr-TR').replace(/[^a-z]/g, '')}${int(1, 99)}@mail.com` : '',
      kind,
      notes: '',
      tax_id: kind === 'company' ? String(int(1000000000, 9999999999)) : '',
      tax_office: kind === 'company' ? pick(['Kadıköy', 'Beşiktaş', 'Kozyatağı', 'Ataşehir']) : '',
      is_active: true,
      vehicle_count: 0,
      cari_account_uuid: null,
      cari_balance: null,
      created_at: at(daysAgo, 10).toISOString(),
      updated_at: at(daysAgo, 10).toISOString(),
    };
    db.customers.push(c);
    const count = kind === 'company' ? int(2, 4) : chance(0.2) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const cat = pick(db.vehicleCatalog);
      const v: MockVehicle = {
        uuid: sid('0e1'),
        customer_uuid: c.uuid,
        plate: plate(),
        brand_uuid: cat.brand_uuid,
        brand_name: cat.brand_name,
        logo_url: null,
        model_uuid: cat.model_uuid,
        model_name: cat.model_name,
        year: cat.year,
        created_at: c.created_at,
      };
      db.vehicles.push(v);
      c.vehicle_count += 1;
    }
    return c;
  };
  for (let i = 0; i < 42; i++) mkCustomer(`${pick(FIRST)} ${pick(LAST)}`, 'individual', int(1, 115));
  for (const name of COMPANIES) mkCustomer(name, 'company', int(20, 115));
  const companies = db.customers.filter((c) => c.kind === 'company');
  db.customers[3].notes = 'Aracı teslimde mutlaka arayın.';
  db.customers[7].is_active = false;

  // Jobs — 90 days back to today
  const vehiclesOf = (c: Customer) => db.vehicles.filter((v) => v.customer_uuid === c.uuid);
  const activeCustomers = db.customers.filter((c) => c.is_active);

  for (let day = 89; day >= 0; day--) {
    const weekday = at(day, 12).getDay();
    const base = weekday === 0 ? 4 : weekday === 6 ? 13 : 8;
    const count = Math.max(2, base + int(-3, 3));
    for (let n = 0; n < count; n++) {
      const customer = chance(0.12) ? pick(companies) : pick(activeCustomers);
      const vehicle = pick(vehiclesOf(customer));
      const startHour = int(8, 18);
      const started = at(day, startHour, int(0, 59));
      const services = [weightedService()];
      if (chance(0.25)) services.push(weightedService());
      const uniq = [...new Map(services.map((s) => [s.uuid, s])).values()];
      const assignee = pick(workers);
      const lines: JobLine[] = uniq.map((s, i) => ({
        uuid: sid('11e'),
        line_type: 'service',
        service_uuid: s.uuid,
        name: s.name,
        unit_price: s.price,
        qty: '1',
        vat_rate: s.vat_rate,
        line_total: s.price,
        currency: 'TRY',
        sort_order: i,
      }));
      const total = lines.reduce((sum, l) => sum + Number(l.line_total), 0);
      const minutes = uniq.reduce((m, s) => m + s.duration_minutes, 0);
      const done = new Date(started.getTime() + (minutes + int(5, 40)) * 60000);

      // Today's jobs spread over the board; older jobs are closed.
      let status: JobDetail['status'] = 'delivered';
      let paid = true;
      if (day === 0) {
        const r = rand();
        if (done.getTime() > Date.now() || r < 0.35) {
          status = 'in_progress';
          paid = false;
        } else if (r < 0.6) {
          status = 'ready';
          paid = chance(0.3);
        }
      } else if (chance(0.02)) {
        status = 'cancelled';
        paid = false;
      } else if (day === 1 && chance(0.15)) {
        status = 'ready';
        paid = false;
      }
      if (status === 'delivered' && day <= 2 && chance(0.08)) paid = false;

      const job: MockDb['jobs'][number] = {
        _org: org.uuid,
        uuid: sid('10b'),
        customer_uuid: customer.uuid,
        vehicle_uuid: vehicle.uuid,
        customer_name: customer.name,
        customer_phone: customer.phone,
        plate: vehicle.plate,
        vehicle_label: `${vehicle.brand_name} ${vehicle.model_name} · ${vehicle.year}`,
        status,
        payment_status: paid ? 'paid' : 'unpaid',
        currency: 'TRY',
        notes: chance(0.08) ? pick(['Jant temizliği hassas yapılsın.', 'Bagajda eşya var, dokunmayın.', 'Müşteri 17:00 gibi alacak.']) : '',
        total_amount: money(total),
        assignee_uuid: assignee.uuid,
        assignee_name: `${assignee.name} ${assignee.surname}`,
        brand_name: vehicle.brand_name,
        brand_logo_url: null,
        services: uniq.map((s) => ({ uuid: s.uuid, name: s.name, color: s.color ?? '' })),
        started_at: started.toISOString(),
        completed_at: status === 'in_progress' ? null : done.toISOString(),
        delivered_at: status === 'delivered' ? new Date(done.getTime() + int(5, 90) * 60000).toISOString() : null,
        paid_at: null,
        created_at: started.toISOString(),
        updated_at: done.toISOString(),
        lines,
        payments: [],
        consumptions: [],
        material_cost: '0.00',
      };

      // Recipe consumption
      let material = 0;
      for (const s of uniq) {
        for (const r of db.serviceProducts.filter((x) => x.service_uuid === s.uuid)) {
          const p = db.products.find((x) => x.uuid === r.product_uuid)!;
          const cost = Number(p.cost_price) * Number(r.qty);
          material += cost;
          job.consumptions.push({
            uuid: sid('c0n'),
            product_uuid: p.uuid,
            name: p.name,
            unit: p.unit,
            qty: r.qty,
            unit_cost: p.cost_price,
            total_cost: money(cost),
            service_name: s.name,
            stock_applied: false,
            reverted: status === 'cancelled',
          });
        }
      }
      job.material_cost = money(material);

      if (paid) {
        const payAt = new Date(done.getTime() + int(1, 30) * 60000).toISOString();
        job.paid_at = payAt;
        const method = customer.kind === 'company' && chance(0.8) ? 'cari' : chance(0.62) ? 'card' : 'cash';
        const payment = {
          uuid: sid('9a1'),
          method,
          amount: money(total),
          currency: 'TRY',
          status: 'posted',
          finance_account_uuid: null as string | null,
          finance_account_name: null as string | null,
          finance_transaction_uuid: null as string | null,
          cari_entry_uuid: null as string | null,
          created_at: payAt,
          voided_at: null,
        } as JobDetail['payments'][number];
        if (method === 'cari') {
          const entry = chargeFromSource(db, customer.uuid, total, `${job.plate} · ${uniq.map((s) => s.name).join(', ')}`, payAt);
          payment.cari_entry_uuid = entry.uuid;
        } else {
          const account = method === 'card' ? bank : cash;
          const txn = postFinance(db, {
            type: 'income',
            accountUuid: account.uuid,
            categoryUuid: catService.uuid,
            amount: total,
            date: istanbulDay(payAt),
            description: `${job.plate} · ${uniq.map((s) => s.name).join(', ')}`,
            paymentMethod: method,
            sourceType: 'service_job',
            sourceUuid: payment.uuid,
            at: payAt,
          });
          payment.finance_account_uuid = account.uuid;
          payment.finance_account_name = account.name;
          payment.finance_transaction_uuid = txn.uuid;
        }
        job.payments.push(payment);
      }
      db.jobs.push(job);
    }

    // Quick sales
    for (let n = 0; n < (chance(0.6) ? int(1, 3) : 0); n++) {
      const product = pick(sellable);
      const qty = int(1, 2);
      const customer = chance(0.4) ? pick(activeCustomers) : null;
      const soldAt = at(day, int(9, 19), int(0, 59)).toISOString();
      const total = Number(product.sale_price) * qty;
      const method = customer && customer.kind === 'company' ? 'cari' : chance(0.55) ? 'card' : 'cash';
      const sale: SaleDetail = {
        uuid: sid('5a1'),
        customer_uuid: customer?.uuid ?? null,
        customer_name: customer?.name ?? '',
        customer_phone: customer?.phone ?? '',
        status: 'posted',
        currency: 'TRY',
        total_amount: money(total),
        method,
        finance_account_uuid: null,
        finance_account_name: null,
        finance_transaction_uuid: null,
        cari_entry_uuid: null,
        notes: '',
        sold_at: soldAt,
        created_at: soldAt,
        voided_at: null,
        lines: [
          {
            uuid: sid('5l1'),
            product_uuid: product.uuid,
            name: product.name,
            unit_price: product.sale_price,
            qty: String(qty),
            vat_rate: product.vat_rate,
            line_total: money(total),
            currency: 'TRY',
            sort_order: 0,
          },
        ],
      };
      if (method === 'cari' && customer) {
        sale.cari_entry_uuid = chargeFromSource(db, customer.uuid, total, `Ürün satışı · ${product.name}`, soldAt).uuid;
      } else {
        const account = defaultAccount(db, method);
        const txn = postFinance(db, {
          type: 'income',
          accountUuid: account.uuid,
          categoryUuid: catSale.uuid,
          amount: total,
          date: istanbulDay(soldAt),
          description: `Ürün satışı · ${product.name}`,
          paymentMethod: method,
          sourceType: 'product_sale',
          sourceUuid: sale.uuid,
          at: soldAt,
        });
        sale.finance_account_uuid = account.uuid;
        sale.finance_account_name = account.name;
        sale.finance_transaction_uuid = txn.uuid;
      }
      db.sales.push(sale);
    }

    // Recurring expenses
    const date = at(day, 10);
    const dayStr = istanbulDay(date);
    if (date.getDate() === 1) {
      postFinance(db, { type: 'expense', accountUuid: bank.uuid, categoryUuid: categoryByName(db, 'Kira', 'expense').uuid, amount: 45000, date: dayStr, description: 'Dükkan kirası', paymentMethod: 'transfer', at: date.toISOString() });
      postFinance(db, { type: 'expense', accountUuid: bank.uuid, categoryUuid: categoryByName(db, 'Personel Maaşı', 'expense').uuid, amount: 68000, date: dayStr, description: 'Personel maaşları', paymentMethod: 'transfer', at: date.toISOString() });
    }
    if (date.getDate() === 12) {
      postFinance(db, { type: 'expense', accountUuid: bank.uuid, categoryUuid: categoryByName(db, 'Elektrik', 'expense').uuid, amount: int(5200, 7800), date: dayStr, description: 'Elektrik faturası', paymentMethod: 'transfer', at: date.toISOString() });
      postFinance(db, { type: 'expense', accountUuid: bank.uuid, categoryUuid: categoryByName(db, 'Su', 'expense').uuid, amount: int(2800, 4200), date: dayStr, description: 'Su faturası', paymentMethod: 'transfer', at: date.toISOString() });
    }
    if (date.getDate() === 20) {
      postFinance(db, { type: 'expense', accountUuid: bank.uuid, categoryUuid: categoryByName(db, 'Vergi & SGK', 'expense').uuid, amount: int(14000, 19000), date: dayStr, description: 'SGK primleri', paymentMethod: 'transfer', at: date.toISOString() });
    }
    if (chance(0.15)) {
      postFinance(db, { type: 'expense', accountUuid: cash.uuid, categoryUuid: categoryByName(db, 'Diğer Gider', 'expense').uuid, amount: int(150, 900), date: dayStr, description: pick(['Çay-kahve', 'Temizlik malzemesi', 'Kargo', 'Yemek']), paymentMethod: 'cash', at: date.toISOString() });
    }
    // Weekly cash → bank transfer
    if (weekday === 1 && day > 0) {
      postFinance(db, { type: 'transfer', accountUuid: cash.uuid, counterAccountUuid: bank.uuid, amount: 8000, date: dayStr, description: 'Kasadan bankaya', paymentMethod: 'transfer', at: date.toISOString() });
    }
  }

  // Suppliers + purchases
  const mkSupplier = (name: string, notes = '') => {
    const s = { uuid: sid('5b1'), name, phone: phone(), email: `siparis@${name.split(' ')[0].toLocaleLowerCase('tr-TR').replace(/[^a-z]/g, '')}.com`, tax_id: String(int(1000000000, 9999999999)), notes, is_active: true, created_at: created, updated_at: created };
    db.suppliers.push(s);
    return s;
  };
  const supChem = mkSupplier('Kimtaş Kimya Ltd.', 'Her pazartesi sipariş');
  const supAcc = mkSupplier('Oto Aksesuar Dünyası');
  const supDetail = mkSupplier('ProDetail Türkiye');
  const supOld = mkSupplier('Eski Tedarikçi A.Ş.');
  supOld.is_active = false;
  const purchaseRows: [number, typeof supChem, [CatalogProduct, number][]][] = [
    [80, supChem, [[pShampoo, 120], [pInterior, 20]]],
    [66, supAcc, [[pFreshener, 60], [pMicro, 20], [pMat, 10]]],
    [52, supChem, [[pShampoo, 100], [pWax, 15]]],
    [38, supDetail, [[pCeramicKit, 6], [pWax, 10]]],
    [24, supChem, [[pShampoo, 120], [pInterior, 20], [pGlass, 24]]],
    [10, supAcc, [[pTire, 30], [pWiper, 10], [pFreshener, 40]]],
    [3, supChem, [[pShampoo, 80]]],
  ];
  for (const [daysAgo, supplier, items] of purchaseRows) {
    const when = at(daysAgo, 11).toISOString();
    const lines = items.map(([p, qty], i) => ({
      uuid: sid('9l1'),
      product_uuid: p.uuid,
      name: p.name,
      unit_cost: p.cost_price,
      qty: String(qty),
      line_total: money(Number(p.cost_price) * qty),
      currency: 'TRY',
      sort_order: i,
    }));
    const total = lines.reduce((s, l) => s + Number(l.line_total), 0);
    const purchase: PurchaseDetail = {
      uuid: sid('9c0'),
      supplier_uuid: supplier.uuid,
      supplier_name: supplier.name,
      status: 'posted',
      currency: 'TRY',
      total_amount: money(total),
      method: 'card',
      finance_account_uuid: bank.uuid,
      finance_account_name: bank.name,
      finance_transaction_uuid: null,
      notes: '',
      purchased_at: when,
      created_at: when,
      voided_at: null,
      lines,
    };
    purchase.finance_transaction_uuid = postFinance(db, {
      type: 'expense',
      accountUuid: bank.uuid,
      categoryUuid: catStock.uuid,
      amount: total,
      date: istanbulDay(when),
      description: `Stok alımı · ${supplier.name}`,
      paymentMethod: 'card',
      sourceType: 'purchase',
      sourceUuid: purchase.uuid,
      at: when,
    }).uuid;
    db.purchases.push(purchase);
  }

  // Cari collections for companies (partial)
  for (const company of companies) {
    const account = cariAccountFor(db, company.uuid);
    const balance = Number(account.balance);
    if (balance > 3000 && chance(0.8)) {
      const amount = Math.round((balance * (0.4 + rand() * 0.4)) / 100) * 100;
      const when = at(int(2, 20), 15);
      const txn = postFinance(db, {
        type: 'income',
        accountUuid: bank.uuid,
        categoryUuid: catCollect.uuid,
        amount,
        date: istanbulDay(when),
        description: `Cari tahsilat · ${company.name}`,
        paymentMethod: 'transfer',
        sourceType: 'cari_payment',
        at: when.toISOString(),
      });
      const entry = postCari(db, account, {
        type: 'payment',
        amount: money(amount),
        delta: -amount,
        entry_date: istanbulDay(when),
        description: 'Havale ile tahsilat',
        payment_method: 'transfer',
        finance_account_uuid: bank.uuid,
        finance_account_name: bank.name,
        finance_transaction_uuid: txn.uuid,
        reference_no: `HVL-${int(10000, 99999)}`,
        at: when.toISOString(),
      });
      txn.source_uuid = entry.uuid;
    }
  }
  // Recompute stock so it reflects the seeded consumptions loosely (keep seeded levels, consumptions not applied).
  moveStock(db, pShampoo.uuid, 0);

  // Leads
  const sources: LeadSource[] = ['incoming_call', 'walk_in', 'whatsapp', 'social', 'referral', 'website', 'outgoing_call', 'other'];
  const interests = ['Seramik kaplama fiyatı', 'PPF tam kaplama', 'Filo için aylık yıkama anlaşması', 'Pasta cila + iç detay', 'Koltuk yıkama', 'Satış öncesi detaylı temizlik', 'Cam filmi', 'Motor yıkama + bakım'];
  const leadStatuses: LeadDetail['status'][] = ['new', 'new', 'contacted', 'contacted', 'quoted', 'quoted', 'won', 'lost', 'new', 'contacted', 'quoted', 'new', 'lost', 'won'];
  leadStatuses.forEach((status, i) => {
    const customer = pick(activeCustomers);
    const vehicle = vehiclesOf(customer)[0];
    const createdAt = at(int(0, 30), int(9, 18)).toISOString();
    const followDays = int(-3, 7);
    const follow = status === 'won' || status === 'lost' ? null : istanbulDay(at(-followDays, 12));
    const assignee = pick(workers);
    const today = istanbulDay();
    const lead: LeadDetail = {
      uuid: sid('1ea'),
      customer_uuid: customer.uuid,
      customer_name: customer.name,
      customer_phone: customer.phone,
      vehicle_plate: vehicle?.plate ?? '',
      vehicle_text: vehicle ? `${vehicle.brand_name} ${vehicle.model_name}` : '',
      interest: pick(interests),
      source: sources[i % sources.length],
      temperature: pick(['cold', 'warm', 'hot'] as const),
      status,
      lost_reason: status === 'lost' ? pick(['Fiyat yüksek bulundu', 'Başka firmayı seçti', 'Vazgeçti']) : '',
      follow_up_date: follow,
      follow_up_state: !follow ? 'none' : follow < today ? 'overdue' : follow === today ? 'today' : 'upcoming',
      assignee: { uuid: assignee.uuid, label: `${assignee.name} ${assignee.surname}` },
      quote_count: 0,
      last_activity_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt,
      vehicle_uuid: vehicle?.uuid ?? null,
      notes: chance(0.5) ? 'Hafta sonu gelmek istiyor.' : '',
      created_by_name: `${owner.name} ${owner.surname}`,
      contacted_at: status === 'new' ? null : createdAt,
      closed_at: status === 'won' || status === 'lost' ? createdAt : null,
      quotes: [],
      events: [
        {
          uuid: sid('1ev'),
          kind: 'created',
          from_value: '',
          to_value: status,
          body: '',
          ref_type: '',
          ref_uuid: null,
          ref_label: '',
          actor_name: `${owner.name} ${owner.surname}`,
          created_at: createdAt,
        },
      ],
    };
    db.leads.push(lead);
  });

  // Todos
  const todoTitles: [string, number | null, string | null][] = [
    ['Kimtaş siparişini ver', 0, '10:00'],
    ['Anadolu Lojistik cari mutabakatı', -2, null],
    ['Seramik kiti stok kontrolü', 1, null],
    ['Ege Rent a Car ile aylık anlaşma görüşmesi', 3, '14:30'],
    ['Yeni personel için eğitim', 5, null],
    ['Basınçlı yıkama makinesi bakımı', -1, '09:00'],
    ['Google yorumlarına dönüş yap', null, null],
    ['Instagram kampanya görseli', 2, null],
    ['Vergi dairesi evrakları', -5, null],
    ['Müşteri memnuniyet anketi', null, null],
  ];
  todoTitles.forEach(([title, dueIn, time], i) => {
    const assignee = i % 3 === 0 ? owner : pick(workers);
    const createdAt = at(int(1, 10), 9).toISOString();
    const done = i === 8 || i === 9 ? false : chance(0.2);
    const due = dueIn == null ? null : istanbulDay(at(-dueIn, 12));
    const customer = title.includes('Anadolu') ? companies.find((c) => c.name.startsWith('Anadolu')) : title.includes('Ege') ? companies.find((c) => c.name.startsWith('Ege')) : null;
    const todo: Todo = {
      uuid: sid('70d'),
      title,
      notes: '',
      due_date: due,
      due_time: time,
      status: done ? 'done' : 'open',
      overdue: !done && due != null && due < istanbulDay(),
      assignee: { uuid: assignee.uuid, label: `${assignee.name} ${assignee.surname}` },
      customer: customer ? { uuid: customer.uuid, label: customer.name } : null,
      job: null,
      lead: null,
      quote: null,
      reminder_offsets: time ? [30] : [],
      next_reminder_at: null,
      via_ai: false,
      created_by_name: `${owner.name} ${owner.surname}`,
      completed_at: done ? at(0, 9).toISOString() : null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    db.todos.push(todo);
  });

  // Quotes go through the same totals engine as the API.
  setDb(db);
  const quoteStatuses = ['draft', 'sent', 'sent', 'viewed', 'accepted', 'accepted', 'rejected', 'draft', 'sent', 'expired', 'cancelled', 'accepted'] as const;
  const quoted = db.leads.filter((l) => l.status === 'quoted' || l.status === 'won');
  quoteStatuses.forEach((status, i) => {
    const lead = quoted[i % Math.max(1, quoted.length)];
    const customer = lead && i < quoted.length ? db.customers.find((c) => c.uuid === lead.customer_uuid)! : pick(activeCustomers);
    const vehicle = vehiclesOf(customer)[0];
    const picks = [pick([sPolish, sCeramic, sInterior, sPpf]), pick([sFull, sSeats, sHeadlight, sOzone])];
    const createdDays = int(1, 25);
    const validDays = status === 'expired' ? -3 : int(3, 20);
    const q = saveQuote(
      null,
      null,
      {
        customer_uuid: customer.uuid,
        lead_uuid: lead && i < quoted.length ? lead.uuid : null,
        vehicle: vehicle ? { vehicle_uuid: vehicle.uuid } : null,
        prices_include_vat: true,
        discount_type: chance(0.4) ? 'percent' : 'none',
        discount_value: '10',
        valid_until: istanbulDay(at(-validDays, 12)),
        notes: 'Fiyatlara KDV dahildir. İşlem süresi yaklaşık 1 gündür.',
        terms: 'Teklif geçerlilik süresi sonunda fiyatlar güncellenebilir.',
        lines: [
          ...picks.map((s) => ({ line_type: 'service', service_uuid: s.uuid, quantity: '1' })),
          ...(chance(0.4) ? [{ line_type: 'product', product_uuid: pMat.uuid, quantity: '1' }] : []),
          ...(chance(0.3) ? [{ line_type: 'custom', description: 'Jant boyama (4 adet)', quantity: '4', unit_price: '750', vat_rate: '20' }] : []),
        ],
      },
      `${owner.name} ${owner.surname}`,
    );
    const createdAt = at(createdDays, int(9, 17)).toISOString();
    q.created_at = createdAt;
    q.updated_at = createdAt;
    q.events.forEach((e) => (e.created_at = createdAt));
    if (status !== 'draft') {
      q.status = status;
      q.sent_at = at(createdDays - 1 > 0 ? createdDays - 1 : 0, 11).toISOString();
      q.deliveries.push({ uuid: sid('de1'), channel: 'whatsapp', recipient: q.customer_phone, status: 'sent', error: '', attempt_count: 1, last_attempt_at: q.sent_at, sent_at: q.sent_at, created_at: q.sent_at });
      if (status === 'viewed') {
        q.viewed_at = at(int(0, 2), 20).toISOString();
        q.view_count = int(1, 4);
      }
      if (status === 'accepted') q.accepted_at = at(int(0, 5), 14).toISOString();
      if (status === 'rejected') {
        q.rejected_at = at(int(0, 5), 14).toISOString();
        q.decision_note = 'Bütçemi aşıyor';
        q.decision_channel = 'public';
      }
      if (status === 'cancelled') q.cancelled_at = at(1, 10).toISOString();
      if (status === 'expired') q.expired_at = at(2, 0).toISOString();
      q.events.unshift({ uuid: sid('qe1'), kind: 'status_changed', from_status: 'draft', to_status: status, body: '', channel: status === 'rejected' ? 'public' : 'tenant', actor_name: `${owner.name} ${owner.surname}`, created_at: q.sent_at });
    }
  });

  return db;
}
