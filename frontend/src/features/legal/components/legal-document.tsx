import { Markdown } from "@/components/markdown/markdown";
import type { AppLocale } from "@/config/i18n";
import { translate } from "@/lib/i18n/messages";
import {
  formatLegalDate,
  legalPath,
  type LegalSlug,
} from "@/features/legal/lib/legal";

import { PublicPageShell } from "./public-page-shell";

export type LegalDocumentData = {
  title: string;
  markdown: string;
  updatedAt: string;
  /** Locale the text is written in (en falls back to tr). */
  contentLocale: AppLocale;
};

type LegalDocumentProps = {
  slug: LegalSlug;
  locale: AppLocale;
  page: LegalDocumentData | null;
  unavailable?: { title: string; body: string };
};

/** Public legal page shell: brand header, title, date, Markdown body. */
export function LegalDocument({
  slug,
  locale,
  page,
  unavailable,
}: LegalDocumentProps) {
  const t = (key: string, params?: Record<string, string>) =>
    translate(locale, key, params, locale);
  const other: AppLocale = locale === "en" ? "tr" : "en";
  return (
    <PublicPageShell locale={locale} switchHref={legalPath(slug, other)}>
      {page ? (
        <article lang={page.contentLocale} className="mt-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {page.title}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            <time dateTime={page.updatedAt}>
              {t("legal.public.last_updated", {
                date: formatLegalDate(page.updatedAt, locale),
              })}
            </time>
          </p>
          <Markdown text={page.markdown} variant="document" className="mt-10" />
        </article>
      ) : unavailable ? (
        <div className="mt-10 rounded-lg border p-6">
          <h1 className="text-xl font-semibold">{unavailable.title}</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {unavailable.body}
          </p>
        </div>
      ) : null}
    </PublicPageShell>
  );
}
