import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { AppWordmark } from "@/components/brand/app-wordmark";
import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";
import { translate } from "@/lib/i18n/messages";

type PublicPageShellProps = {
  locale: AppLocale;
  /** Same page in the other locale. */
  switchHref: string;
  children: ReactNode;
};

/** Brand header, locale switch and back link shared by public info pages. */
export function PublicPageShell({
  locale,
  switchHref,
  children,
}: PublicPageShellProps) {
  const t = (key: string) => translate(locale, key, undefined, locale);
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
            href={switchHref}
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
        {children}
      </main>
    </div>
  );
}
