import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppWordmark } from "@/components/brand/app-wordmark";
import { Markdown } from "@/components/markdown/markdown";
import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";
import { translate } from "@/lib/i18n/messages";
import { formatLegalDate, privacyPath } from "@/features/legal/lib/legal";

export type LegalDocumentData = {
  title: string;
  markdown: string;
  updatedAt: string;
  /** Locale the text is written in (en falls back to tr). */
  contentLocale: AppLocale;
};

type LegalDocumentProps = {
  locale: AppLocale;
  page: LegalDocumentData | null;
  unavailable?: { title: string; body: string };
};

/** Public legal page shell: brand header, title, date, Markdown body. */
export function LegalDocument({
  locale,
  page,
  unavailable,
}: LegalDocumentProps) {
  const t = (key: string, params?: Record<string, string>) =>
    translate(locale, key, params, locale);
  const home = locale === "en" ? "/en" : routes.public.root;
  const other: AppLocale = locale === "en" ? "tr" : "en";
  return (
    <div className="bg-background min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={home} aria-label={t("legal.public.back_home")}>
            <AppWordmark className="h-7" />
          </Link>
          <Link
            href={privacyPath(other)}
            hrefLang={other}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            {t("legal.public.switch_locale")}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href={home}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("legal.public.back_home")}
        </Link>
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
            <Markdown
              text={page.markdown}
              variant="document"
              className="mt-10"
            />
          </article>
        ) : unavailable ? (
          <div className="mt-10 rounded-lg border p-6">
            <h1 className="text-xl font-semibold">{unavailable.title}</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {unavailable.body}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
