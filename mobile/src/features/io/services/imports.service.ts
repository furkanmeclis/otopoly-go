import { platformRequest } from '@/api/client';
import { downloadAndShare, platformFormRequest, type UploadFile } from '@/api/files';
import type { ExportJobScope, ImportFormat, ImportJob } from '@/features/io/types';

export type ListImportJobsResult = {
  items: ImportJob[];
  total: number;
  limit: number;
  offset: number;
};

function importsBase(scope: ExportJobScope = 'tenant') {
  return scope === 'tenant' ? '/v1/tenant/imports' : '/v1/platform/imports';
}

/** Mobile port of the web `importsService` (upload, wizard steps, job list / detail / rollback). */
export const importsService = {
  /** Multipart upload of a picked file (`IMPORT_PATHS[resource].upload`); the backend answers with the new job. */
  upload(path: string, file: UploadFile, format: ImportFormat, locale: string) {
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    form.append('format', format);
    form.append('locale', locale);
    return platformFormRequest<ImportJob>('POST', path, form);
  },
  /** Sample file for a resource, saved to the cache and handed to the share sheet (web: browser download). */
  downloadSample(path: string, format: ImportFormat, locale: string) {
    const sep = path.includes('?') ? '&' : '?';
    const mime = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === 'json' ? 'application/json' : 'text/plain';
    return downloadAndShare(`${path}${sep}format=${format}&locale=${locale}`, `sample.${format}`, mime);
  },
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
