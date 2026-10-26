/**
 * Tenant export settings / letterhead (`/v1/tenant/settings`), ported from web
 * `features/io/services/settings.service.ts` (tenant scope only). Kept outside `features/io`,
 * which belongs to the documents area.
 */
import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import { platformFormRequest, type UploadFile } from '@/api/files';
import type { AppSettings } from '@/features/io/types';
import { qk } from '@/features/queries';

export type PatchSettingsRequest = Partial<Omit<AppSettings, 'logo_url'>>;

export const PAPER_SIZES = ['A4', 'A3', 'Letter', 'Legal'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export const BRAND_PRIMARY = '#EA6E43';
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const exportSettingsService = {
  get: () => request<AppSettings>('GET', '/v1/tenant/settings'),
  patch: (body: PatchSettingsRequest) => request<AppSettings>('PATCH', '/v1/tenant/settings', { body }),
  deleteLogo: () => request<AppSettings>('DELETE', '/v1/tenant/settings/logo'),
  /** Multipart part `logo`: PNG / JPEG / WebP (sniffed by the API), at most 2 MiB. */
  uploadLogo: (file: UploadFile) => {
    const form = new FormData();
    form.append('logo', file as unknown as Blob);
    return platformFormRequest<AppSettings>('PUT', '/v1/tenant/settings/logo', form);
  },
};

export const exportSettingsKey = [...qk.settings, 'export'] as const;

export const useExportSettings = (enabled: boolean) => useQuery({ queryKey: exportSettingsKey, queryFn: exportSettingsService.get, enabled });

export function normalizeHexColor(value: string, fallback: string): string {
  const v = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v;
  if (/^[0-9A-Fa-f]{6}$/.test(v)) return `#${v}`;
  return fallback;
}
