import { useState } from 'react';

import { useToast } from '@/components/feedback/toast';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

import { exportsService } from './services/exports.service';
import type { ExportJob } from './types';

const log = createLogger('screen.exports');

/** Download a finished export into the cache and open the share sheet (web: browser download). */
export function useShareExport() {
  const { t: tr } = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const share = async (job: ExportJob) => {
    setBusy(job.uuid);
    try {
      await exportsService.download(job);
    } catch (error) {
      log.error('Export download failed', { uuid: job.uuid, error });
      toast.error(tr('exports.toast.download_failed'));
    } finally {
      setBusy(null);
    }
  };
  return { share, busy };
}
