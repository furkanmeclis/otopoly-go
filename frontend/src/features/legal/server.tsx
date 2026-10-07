import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { upstreamConfig } from "@/config/api";
import type { AppLocale } from "@/config/i18n";
import { site } from "@/config/site";
import {
  LegalDocument,
  type LegalDocumentData,
} from "@/features/legal/components/legal-document";
import { LEGAL_CONTACT_EMAIL, privacyPath } from "@/features/legal/lib/legal";
import { translate } from "@/lib/i18n/messages";

/** Matches the API's Cache-Control max-age; admin edits show within a minute. */
const REVALIDATE_SECONDS = 60;

type PublicLegalPage = {
  slug: string;
  locale: AppLocale;
  title: string;
  markdown: string;
  updated_at: string;
};

type FetchResult =
  | { kind: "ok"; page: LegalDocumentData }
  | { kind: "not_found" }
  | { kind: "error" };

/** GET /v1/public/legal/{slug} from the server (no auth). */
async function fetchLegalPage(
  slug: string,
  locale: AppLocale,
): Promise<FetchResult> {
  try {
    const res = await fetch(
      `${upstreamConfig.baseUrl}/public/legal/${encodeURIComponent(slug)}?locale=${locale}`,
      {
        next: { revalidate: REVALIDATE_SECONDS, tags: [`legal:${slug}`] },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as { data?: PublicLegalPage };
    if (!body.data) return { kind: "error" };
    return {
      kind: "ok",
      page: {
        title: body.data.title,
        markdown: body.data.markdown,
        updatedAt: body.data.updated_at,
        contentLocale: body.data.locale,
      },
    };
  } catch {
    return { kind: "error" };
  }
}

const t = (locale: AppLocale, key: string, params?: Record<string, string>) =>
  translate(locale, key, params, locale);

export async function privacyMetadata(locale: AppLocale): Promise<Metadata> {
  const result = await fetchLegalPage("privacy", locale);
  const title =
    result.kind === "ok"
      ? result.page.title
      : t(locale, "legal.public.privacy_link");
  const description = t(locale, "legal.public.privacy_description");
  const path = privacyPath(locale);
  return {
    title: { absolute: `${title} | ${site.name}` },
    description,
    alternates: {
      canonical: path,
      languages: {
        tr: privacyPath("tr"),
        en: privacyPath("en"),
        "x-default": privacyPath("tr"),
      },
    },
    openGraph: {
      type: "article",
      url: path,
      siteName: site.name,
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export async function PrivacyRoute({ locale }: { locale: AppLocale }) {
  const result = await fetchLegalPage("privacy", locale);
  if (result.kind === "not_found") notFound();
  return (
    <LegalDocument
      locale={locale}
      page={result.kind === "ok" ? result.page : null}
      unavailable={{
        title: t(locale, "legal.public.unavailable_title"),
        body: t(locale, "legal.public.unavailable_body", {
          email: LEGAL_CONTACT_EMAIL,
        }),
      }}
    />
  );
}
