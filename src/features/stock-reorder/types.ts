/** Stock reorder suggestions (`/v1/tenant/stock-reorder/*`; web `features/stock-reorder`). */

export type ReorderUrgency = 'out_of_stock' | 'below_min' | 'low_cover' | 'none';
export type ReorderUrgencyFilter = Exclude<ReorderUrgency, 'none'>;

export type ReorderSupplierRef = { uuid: string; name: string; source: 'product' | 'last_purchase' };

export type ReorderProductOverride = {
  supplier_uuid: string | null;
  supplier_name?: string | null;
  lead_days: number | null;
  target_days: number | null;
  pack_size: string | null;
};

/** Every input of the formula, returned with each suggestion. */
export type ReorderInputs = {
  velocity_days: number;
  consumed_qty: string;
  sold_qty: string;
  lead_days: number;
  lead_days_source: 'product' | 'supplier' | 'organization';
  target_days: number;
  target_days_source: 'product' | 'organization';
  demand_qty: string;
  raw_need: string;
  formula: string;
};

export type ReorderSuggestion = {
  product_uuid: string;
  name: string;
  sku: string;
  unit: string;
  currency: string;
  urgency: ReorderUrgency;
  stock: string;
  min_stock: string;
  on_order: string;
  velocity_per_day: string;
  /** null = no usage in the window (infinite cover). */
  days_of_cover: string | null;
  suggested_qty: string;
  pack_size: string | null;
  packs: number | null;
  supplier: ReorderSupplierRef | null;
  unit_cost: string;
  unit_cost_source: 'last_purchase' | 'cost_price';
  estimated_total: string;
  last_purchased_at: string | null;
  inputs: ReorderInputs;
  override: ReorderProductOverride | null;
};

export type ReorderSummary = {
  out_of_stock: number;
  below_min: number;
  low_cover: number;
  /** out_of_stock + below_min (menu badge). */
  urgent: number;
  suggested: number;
  drafts: number;
};

export type ReorderSupplierLead = { supplier_uuid: string; supplier_name?: string; lead_days: number };

export type ReorderSettings = {
  velocity_days: number;
  lead_days: number;
  target_days: number;
  notify_enabled: boolean;
  notify_time: string;
  supplier_lead_days: ReorderSupplierLead[];
  velocity_day_options: number[];
};

export type ReorderList = {
  items: ReorderSuggestion[];
  total: number;
  summary: ReorderSummary;
  settings: ReorderSettings;
  generated_at: string;
};

export type ReorderListParams = { urgency?: ReorderUrgencyFilter; supplier_uuid?: string; q?: string; all?: boolean };

export type ReorderSettingsInput = {
  velocity_days: number;
  lead_days: number;
  target_days: number;
  notify_enabled: boolean;
  supplier_lead_days?: { supplier_uuid: string; lead_days: number }[];
};

export type ReorderOverrideInput = {
  supplier_uuid?: string | null;
  lead_days?: number | null;
  target_days?: number | null;
  pack_size?: string | null;
};

export type ReorderDraftItem = { product_uuid: string; qty: string; supplier_uuid?: string | null; unit_cost?: string | null };
export type CreateReorderDraftsInput = { notes?: string; items: ReorderDraftItem[] };

export type PostDraftInput = {
  method: 'cash' | 'card';
  finance_account_uuid: string;
  purchased_at?: string;
  notes?: string;
  lines?: { product_uuid: string; qty?: string; unit_cost?: string }[];
};
