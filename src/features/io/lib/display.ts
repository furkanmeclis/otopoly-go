/** Display helpers ported from web `features/io/lib/display.ts`. */
import type { Tone } from '@/components/ui';

type T = (key: string, params?: Record<string, string | number>) => string;

/** `exports.resources.tenant.jobs` style label, falling back to the raw resource slug. */
export function formatResource(t: T, ns: 'exports' | 'imports', resource: string): string {
  const key = `${ns}.resources.${resource}`;
  const label = t(key);
  if (label !== key) return label;
  // imports.* has no catalog resource labels; the exports catalog covers every tenant resource.
  const fallbackKey = `exports.resources.${resource}`;
  const fallback = t(fallbackKey);
  return fallback === fallbackKey ? resource : fallback;
}

export function formatExportStatus(t: T, status: string): string {
  const key = `exports.status.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function formatImportStatus(t: T, status: string): string {
  const key = `imports.status.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function formatExportFormat(t: T, format: string): string {
  const key = `exports.formats.${format.toLowerCase()}`;
  const translated = t(key);
  return translated === key ? format.toUpperCase() : translated;
}

export function formatImportFormat(t: T, format: string): string {
  const key = `imports.formats.${format.toLowerCase()}`;
  const translated = t(key);
  return translated === key ? format.toUpperCase() : translated;
}

/** Web badge variants → mobile tones (completed=default/primary, failed=danger, processing=secondary). */
export function exportStatusTone(status: string): Tone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'processing') return 'info';
  return 'neutral';
}

export function importStatusTone(status: string): Tone {
  if (status === 'applied') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'applying' || status === 'queued') return 'info';
  return 'neutral';
}

/** Export jobs still running — screens poll while any job is in one of these. */
export const isExportRunning = (status: string) => status === 'pending' || status === 'processing';
/** Import jobs whose state can still change without user action. */
export const isImportRunning = (status: string) => status === 'queued' || status === 'applying';

export function rollbackWindowOpen(rollbackUntil: string | null | undefined, nowMs: number): boolean {
  return Boolean(rollbackUntil && Date.parse(rollbackUntil) > nowMs);
}

/** Client-side filename (web fallback when Content-Disposition is missing). */
export function exportDownloadFilename(resource: string, format: string, at?: Date): string {
  const slug = resource.includes('.') ? resource.split('.').pop()! : resource;
  const f = format.toLowerCase();
  const ext = f === 'pdf' ? 'pdf' : f === 'xlsx' ? 'xlsx' : f === 'json' ? 'json' : 'csv';
  const date = (at ?? new Date()).toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug}_${date}.${ext}`;
}

export function exportMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case 'pdf':
      return 'application/pdf';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'json':
      return 'application/json';
    default:
      return 'text/csv';
  }
}

/** API mapping `{ "File column": "field_key" }` → `{ field_key: "File column" }` (web `apiMappingToUi`). */
export function apiMappingToUi(api: Record<string, string> | undefined): Record<string, string> {
  const ui: Record<string, string> = {};
  if (!api) return ui;
  for (const [header, fieldKey] of Object.entries(api)) if (header && fieldKey) ui[fieldKey] = header;
  return ui;
}
