/** React Query hooks for tenant export / import jobs (web `features/io/hooks`). */
import { useQuery } from '@tanstack/react-query';

import { qk, useInfiniteList } from '@/features/queries';

import { isExportRunning, isImportRunning } from './lib/display';
import { exportsService } from './services/exports.service';
import { importsService } from './services/imports.service';

export const ioKeys = {
  exports: [...qk.io, 'exports'] as const,
  imports: [...qk.io, 'imports'] as const,
};

/** Poll interval while a job is still being produced by the worker. */
const POLL_MS = 2500;

export function useExportJobsInfinite(enabled = true) {
  const list = useInfiniteList(ioKeys.exports, (p) => exportsService.list(p, 'tenant'), {}, enabled);
  return list;
}

export const useExportJob = (uuid: string) =>
  useQuery({
    queryKey: [...ioKeys.exports, 'detail', uuid],
    queryFn: () => exportsService.get(uuid, 'tenant'),
    enabled: Boolean(uuid),
    refetchInterval: (q) => (q.state.data && isExportRunning(q.state.data.status) ? POLL_MS : false),
  });

export function useImportJobsInfinite(enabled = true) {
  return useInfiniteList(ioKeys.imports, (p) => importsService.list(p, 'tenant'), {}, enabled);
}

export const useImportJob = (uuid: string) =>
  useQuery({
    queryKey: [...ioKeys.imports, 'detail', uuid],
    queryFn: () => importsService.get(uuid, 'tenant'),
    enabled: Boolean(uuid),
    refetchInterval: (q) => (q.state.data && isImportRunning(q.state.data.status) ? POLL_MS : false),
  });

export { POLL_MS as IO_POLL_MS };
