import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";

/** Mirrors the backend cap (MaxMarkdownBytes) per locale. */
export const LEGAL_MAX_MARKDOWN_BYTES = 100 * 1024;

export const LEGAL_CONTACT_EMAIL = "contact@otopoly.app";

const encoder = new TextEncoder();

/** UTF-8 size, as the backend counts it. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** Public URL of the privacy page in locale. */
export function privacyPath(locale: AppLocale): string {
  return locale === "en" ? routes.public.privacyEn : routes.public.privacy;
}

/** Date only, in Türkiye time so the shown day matches the admin's edit. */
export function formatLegalDate(iso: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Istanbul",
  }).format(new Date(iso));
}
