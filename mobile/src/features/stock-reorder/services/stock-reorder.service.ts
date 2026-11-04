/** Stock reorder API (`/v1/tenant/stock-reorder/*`) and draft purchase actions (`/v1/tenant/purchases/{uuid}/…`). */
import { request } from '@/api/client';
import type { PurchaseDetail } from '@/features/purchases/services/purchases.service';

import type {
  CreateReorderDraftsInput,
  PostDraftInput,
  ReorderList,
  ReorderListParams,
  ReorderOverrideInput,
  ReorderProductOverride,
  ReorderSettings,
  ReorderSettingsInput,
  ReorderSummary,
} from '../types';

type OverrideResponse = { product_uuid: string; override: ReorderProductOverride | null };

export const stockReorderService = {
  list: (params: ReorderListParams = {}) =>
    request<ReorderList>('GET', '/v1/tenant/stock-reorder/suggestions', {
      query: { urgency: params.urgency, supplier_uuid: params.supplier_uuid, q: params.q, all: params.all ? 'true' : undefined },
    }),
  /** Silent: the menu badge must not open the plan dialog when the module is off. */
  summary: () => request<ReorderSummary>('GET', '/v1/tenant/stock-reorder/summary', { silent: true }),
  settings: () => request<ReorderSettings>('GET', '/v1/tenant/stock-reorder/settings'),
  updateSettings: (body: ReorderSettingsInput) => request<ReorderSettings>('PUT', '/v1/tenant/stock-reorder/settings', { body }),
  productOverride: (productUuid: string) => request<OverrideResponse>('GET', `/v1/tenant/stock-reorder/products/${productUuid}`),
  setProductOverride: (productUuid: string, body: ReorderOverrideInput) => request<OverrideResponse>('PUT', `/v1/tenant/stock-reorder/products/${productUuid}`, { body }),
  createDrafts: (body: CreateReorderDraftsInput) => request<{ drafts: PurchaseDetail[] }>('POST', '/v1/tenant/stock-reorder/drafts', { body }),
  postDraft: (uuid: string, body: PostDraftInput) => request<PurchaseDetail>('POST', `/v1/tenant/purchases/${uuid}/post`, { body }),
  deleteDraft: (uuid: string) => request<{ deleted: boolean }>('DELETE', `/v1/tenant/purchases/${uuid}`),
  clearProductOverride: (productUuid: string) => request<{ deleted: boolean }>('DELETE', `/v1/tenant/stock-reorder/products/${productUuid}`),
};
