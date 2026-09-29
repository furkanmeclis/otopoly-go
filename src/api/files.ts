import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { env, isMock } from '@/config/env';
import { getCurrentLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

import { ApiError, parseApiError } from './errors';
import { session } from './session';

const log = createLogger('files');

/** A file picked on the device, ready for multipart upload. */
export type UploadFile = { uri: string; name: string; type: string };

/**
 * Multipart upload (`FormData`) to the Go API. Mobile counterpart of the web `platformFormRequest`.
 * In mock mode the upload is accepted and a stub result is returned by the mock server.
 */
export async function platformFormRequest<T>(method: string, path: string, form: FormData): Promise<T> {
  if (isMock) {
    const { mockFormRequest } = await import('./mock');
    return mockFormRequest<T>(method, path, form);
  }
  const s = session.get();
  const response = await fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Accept-Language': getCurrentLocale(),
      ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}),
    },
    body: form,
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw parseApiError(response.status, payload);
  return (payload as { data: T }).data;
}

// A tiny valid one-page PDF so share sheets work in demo mode.
function mockPdf(title: string) {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  return `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
}

/**
 * Downloads an authenticated API file (PDF, XLSX…) into the cache and opens the share sheet.
 * Mobile counterpart of the web `platformDownloadFile` + `triggerBrowserDownload`.
 */
export async function downloadAndShare(path: string, filename: string, mimeType = 'application/pdf') {
  log.info('Download requested', { path, filename });
  try {
    const target = new File(Paths.cache, filename);
    if (target.exists) target.delete();

    if (isMock) {
      target.create();
      target.write(mockPdf(filename));
    } else {
      const s = session.get();
      await File.downloadFileAsync(`${env.apiUrl}${path}`, target, {
        headers: {
          'Accept-Language': getCurrentLocale(),
          ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}),
        },
      });
    }

    if (!(await Sharing.isAvailableAsync())) {
      log.warn('Sharing unavailable on this device');
      return target.uri;
    }
    await Sharing.shareAsync(target.uri, { mimeType, dialogTitle: filename });
    log.info('File shared', { filename });
    return target.uri;
  } catch (error) {
    log.error('Download failed', { path, error });
    throw error instanceof ApiError
      ? error
      : new ApiError({ status: 0, code: 'NETWORK_ERROR', message: String((error as Error)?.message ?? error) });
  }
}

/** Absolute URL for API-served media (logos, images). Never assemble storage keys client-side. */
export function apiUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${env.apiUrl}${path}`;
}
