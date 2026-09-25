/**
 * Mirrors backend/internal/platform/msgtemplate: plain-text `{{key}}`
 * substitution in one pass (whitespace and a leading dot tolerated), missing
 * values render empty, no nested expansion.
 */
const PLACEHOLDER_RE = /\{\{\s*\.?([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(
    PLACEHOLDER_RE,
    (_m, key: string) => vars[key.toLowerCase()] ?? "",
  );
}

export function templatePlaceholders(tpl: string): string[] {
  const out = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER_RE)) out.add(m[1].toLowerCase());
  return [...out].sort();
}

export function unknownPlaceholders(
  allowed: readonly string[],
  ...texts: string[]
): string[] {
  const ok = new Set(allowed);
  const out = new Set<string>();
  for (const text of texts) {
    for (const key of templatePlaceholders(text)) {
      if (!ok.has(key)) out.add(key);
    }
  }
  return [...out].sort();
}

/** i18n key suffix for a template type ("quote.sent" → "quote_sent"). */
export function typeKey(type: string): string {
  return type.replaceAll(".", "_");
}
