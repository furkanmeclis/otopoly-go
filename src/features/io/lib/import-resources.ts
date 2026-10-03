import { File } from 'expo-file-system';

import { P, type Permission } from '@/features/auth/permissions';
import type { ImportFormat, IoResource } from '@/features/io/types';

export const IMPORT_FORMATS: ImportFormat[] = ['xlsx', 'csv', 'tsv', 'json'];

/** Backend multipart cap for import uploads (`ParseMultipartForm(10 << 20)`). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Tenant resources a mobile owner can import, with the permission the upload route requires (web
 * `ResourceIOToolbar` IMPORT_PERM). Catalog imports are left out: their web path
 * (`POST /v1/tenant/imports`) has no backend route — only finance accounts / categories do.
 */
export const TENANT_IMPORTS: { resource: IoResource; perm: Permission }[] = [
  { resource: 'tenant.finance.accounts', perm: P.financeImport },
  { resource: 'tenant.finance.categories', perm: P.financeImport },
];

/** Document picker MIME filter per format. `text/plain` is included because Files often labels CSV/TSV/JSON that way. */
export function importMimeTypes(format: ImportFormat): string[] {
  switch (format) {
    case 'xlsx':
      return ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    case 'csv':
      return ['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain'];
    case 'tsv':
      return ['text/tab-separated-values', 'text/plain'];
    case 'json':
      return ['application/json', 'text/plain'];
  }
}

/** Guess the format from a picked file name so the format chip follows the file. */
export function formatFromFileName(name: string): ImportFormat | null {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'xlsx' || ext === 'csv' || ext === 'tsv' || ext === 'json' ? ext : null;
}

export function parseDelimitedHeaders(text: string, delimiter: string): string[] {
  const line = text.split(/\r?\n/).find((l) => l.trim());
  if (!line) return [];
  return line
    .replace(/^﻿/, '')
    .split(delimiter)
    .map((h) => h.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

export function parseJsonHeaders(text: string): string[] {
  try {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data) && data[0] && typeof data[0] === 'object') return Object.keys(data[0] as Record<string, unknown>);
  } catch {
    // not JSON, or not an array of objects
  }
  return [];
}

/**
 * Column headers of a picked file, read on the device like the web `readFileHeaders`.
 * XLSX is binary, so its headers come from the server's suggested mapping instead.
 */
export async function readFileHeaders(uri: string, format: ImportFormat): Promise<string[]> {
  if (format === 'xlsx') return [];
  try {
    const text = await new File(uri).text();
    if (format === 'json') return parseJsonHeaders(text);
    return parseDelimitedHeaders(text.slice(0, 4096), format === 'tsv' ? '\t' : ',');
  } catch {
    return [];
  }
}
