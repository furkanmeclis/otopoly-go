import Link from "next/link";
import type { Metadata } from "next";
import { Mail } from "lucide-react";

import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";
import { site } from "@/config/site";
import { LEGAL_CONTACT_EMAIL } from "@/features/legal/lib/legal";
import { translate } from "@/lib/i18n/messages";

import { PublicPageShell } from "./public-page-shell";

const COMPANY = "TechnoWide Software";

export function supportPath(locale: AppLocale): string {
  return locale === "en" ? routes.public.supportEn : routes.public.support;
}

const t = (locale: AppLocale, key: string) =>
  translate(locale, `legal.support.${key}`, undefined, locale);

export function supportMetadata(locale: AppLocale): Metadata {
  const title = t(locale, "title");
  const description = t(locale, "description");
  const path = supportPath(locale);
  return {
    title,
    description,
    alternates: {
      canonical: path,
      languages: {
        tr: supportPath("tr"),
        en: supportPath("en"),
        "x-default": supportPath("tr"),
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

/** Public support page: contact details and short FAQ (App Store support URL). */
export function SupportPage({ locale }: { locale: AppLocale }) {
  const other: AppLocale = locale === "en" ? "tr" : "en";
  const accountDelete =
    locale === "en"
      ? routes.public.accountDeleteEn
      : routes.public.accountDelete;
  const privacy =
    locale === "en" ? routes.public.privacyEn : routes.public.privacy;
  const faq = [
    { q: "faq_account_q", a: "faq_account_a" },
    { q: "faq_signin_q", a: "faq_signin_a" },
    {
      q: "faq_delete_q",
      a: "faq_delete_a",
      link: { href: accountDelete, label: "faq_delete_link" },
    },
    {
      q: "faq_privacy_q",
      a: "faq_privacy_a",
      link: { href: privacy, label: "../public.privacy_link" },
    },
  ];
  const label = (key: string) =>
    key.startsWith("../")
      ? translate(locale, `legal.${key.slice(3)}`, undefined, locale)
      : t(locale, key);

  return (
    <PublicPageShell locale={locale} switchHref={supportPath(other)}>
      <article className="mt-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t(locale, "title")}
        </h1>
        <p className="text-muted-foreground mt-4 text-base text-pretty">
          {t(locale, "intro")}
        </p>

        <section className="mt-10 rounded-lg border p-6">
          <h2 className="text-lg font-semibold">
            {t(locale, "contact_title")}
          </h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">
              {t(locale, "contact_email_label")}
            </dt>
            <dd>
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
              >
                <Mail className="size-4" aria-hidden />
                {LEGAL_CONTACT_EMAIL}
              </a>
            </dd>
            <dt className="text-muted-foreground">
              {t(locale, "contact_company_label")}
            </dt>
            <dd>{COMPANY}</dd>
          </dl>
          <p className="text-muted-foreground mt-4 text-sm">
            {t(locale, "contact_hours")}
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">{t(locale, "faq_title")}</h2>
          <dl className="mt-6 space-y-6">
            {faq.map((item) => (
              <div key={item.q}>
                <dt className="font-medium">{t(locale, item.q)}</dt>
                <dd className="text-muted-foreground mt-1.5 text-sm">
                  {t(locale, item.a)}
                  {item.link ? (
                    <>
                      {" "}
                      <Link
                        href={item.link.href}
                        className="text-primary font-medium underline-offset-4 hover:underline"
                      >
                        {label(item.link.label)}
                      </Link>
                    </>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </PublicPageShell>
  );
}
