import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { Suspense } from "react";

import { AppWordmark } from "@/components/brand/app-wordmark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";
import { site } from "@/config/site";
import { LEGAL_CONTACT_EMAIL } from "@/features/legal/lib/legal";
import { translate } from "@/lib/i18n/messages";

import { AccountDeletionFlow } from "./account-deletion-flow";

function deletionPath(locale: AppLocale) {
  return locale === "en"
    ? routes.public.accountDeleteEn
    : routes.public.accountDelete;
}

function tr(locale: AppLocale) {
  return (key: string, params?: Record<string, string>) =>
    translate(locale, key, params, locale);
}

export function accountDeletionMetadata(locale: AppLocale): Metadata {
  const t = tr(locale);
  const title = t("auth.account_deletion.meta_title");
  const description = t("auth.account_deletion.meta_description");
  const path = deletionPath(locale);
  return {
    title,
    description,
    alternates: {
      canonical: path,
      languages: {
        tr: deletionPath("tr"),
        en: deletionPath("en"),
        "x-default": deletionPath("tr"),
      },
    },
    openGraph: {
      type: "website",
      url: path,
      siteName: site.name,
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

/** Public /account/delete page (store-required web deletion + recovery). */
export function AccountDeletionPage({ locale }: { locale: AppLocale }) {
  const t = tr(locale);
  const a = (key: string, params?: Record<string, string>) =>
    t(`auth.account_deletion.${key}`, params);
  const home = locale === "en" ? "/en" : routes.public.root;
  const other: AppLocale = locale === "en" ? "tr" : "en";
  const sections = [
    { title: a("removed_title"), body: a("removed_body") },
    { title: a("kept_title"), body: a("kept_body") },
    {
      title: a("owner_title"),
      body: a("owner_body", { email: LEGAL_CONTACT_EMAIL }),
    },
  ];
  return (
    <div className="bg-background min-h-svh" lang={locale}>
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={home} aria-label={t("legal.public.back_home")}>
            <AppWordmark className="h-7" />
          </Link>
          <Link
            href={deletionPath(other)}
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
        <h1 className="font-display mt-8 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {a("title")}
        </h1>
        <p className="text-muted-foreground mt-4">{a("intro")}</p>
        <Alert className="mt-6">
          <Clock aria-hidden />
          <AlertDescription className="text-foreground font-medium">
            {a("grace_notice")}
          </AlertDescription>
        </Alert>

        <div className="mx-auto max-w-md">
          <Suspense fallback={<div className="mt-8 h-64" aria-hidden />}>
            <AccountDeletionFlow locale={locale} />
          </Suspense>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-base font-semibold">{section.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {section.body}
              </p>
            </section>
          ))}
        </div>
        <p className="text-muted-foreground mt-10 text-sm">
          {a("in_app_hint")}
        </p>
      </main>
    </div>
  );
}
