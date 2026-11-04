import { platformRequest } from '@/api/client';
import { downloadAndShare } from '@/api/files';
import { exportDownloadFilename, exportMimeType } from '@/features/io/lib/display';
import type { ExportFormat, ExportJob, ExportJobScope } from '@/features/io/types';

export type ListJobsResult = {
  items: ExportJob[];
  total: number;
  limit: number;
  offset: number;
};

function exportsBase(scope: ExportJobScope = 'tenant') {
  return scope === 'tenant' ? '/v1/tenant/exports' : '/v1/platform/exports';
}

/** Mobile port of the web `exportsService` (download → share sheet instead of a browser download). */
export const exportsService = {
  request(path: string, body: { format: ExportFormat; query?: Record<string, string>; locale?: string }) {
    return platformRequest<ExportJob>('POST', path, { body });
  },

  list(params: { limit?: number; offset?: number }, scope: ExportJobScope = 'tenant') {
    return platformRequest<ListJobsResult>('GET', exportsBase(scope), { query: params });
  },

  get(uuid: string, scope: ExportJobScope = 'tenant') {
    return platformRequest<ExportJob>('GET', `${exportsBase(scope)}/${uuid}`);
  },

  download(job: ExportJob, scope: ExportJobScope = 'tenant') {
    return downloadAndShare(
      `${exportsBase(scope)}/${job.uuid}/download`,
      exportDownloadFilename(job.resource, job.format, new Date(job.created_at)),
      exportMimeType(job.format),
    );
  },
};
