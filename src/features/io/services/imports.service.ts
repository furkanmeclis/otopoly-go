import { platformRequest } from '@/api/client';
import type { ExportJobScope, ImportJob } from '@/features/io/types';

export type ListImportJobsResult = {
  items: ImportJob[];
  total: number;
  limit: number;
  offset: number;
};

function importsBase(scope: ExportJobScope = 'tenant') {
  return scope === 'tenant' ? '/v1/tenant/imports' : '/v1/platform/imports';
}

/**
 * Mobile port of the web `importsService` (job list / detail / rollback + wizard steps).
 * File upload is web-only for now (no document picker in the app), so `upload`/`downloadSample` are not ported.
 */
export const importsService = {
  updateMapping(uuid: string, body: { mapping: Record<string, string>; defaults?: Record<string, string> }, scope: ExportJobScope = 'tenant') {
    return platformRequest<ImportJob>('PATCH', `${importsBase(scope)}/${uuid}/mapping`, { body });
  },
  preview(uuid: string, scope: ExportJobScope = 'tenant') {
    return platformRequest<ImportJob>('POST', `${importsBase(scope)}/${uuid}/preview`);
  },
  confirm(uuid: string, scope: ExportJobScope = 'tenant') {
    return platformRequest<ImportJob>('POST', `${importsBase(scope)}/${uuid}/confirm`);
  },
  rollback(uuid: string, scope: ExportJobScope = 'tenant') {
    return platformRequest<ImportJob>('POST', `${importsBase(scope)}/${uuid}/rollback`);
  },
  list(params: { limit?: number; offset?: number }, scope: ExportJobScope = 'tenant') {
    return platformRequest<ListImportJobsResult>('GET', importsBase(scope), { query: params });
  },
  get(uuid: string, scope: ExportJobScope = 'tenant') {
    return platformRequest<ImportJob>('GET', `${importsBase(scope)}/${uuid}`);
  },
};
