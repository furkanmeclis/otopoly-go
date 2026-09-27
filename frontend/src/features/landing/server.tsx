import type { Metadata } from "next";

import { upstreamConfig } from "@/config/api";
import { site } from "@/config/site";
import { LandingPage } from "@/features/landing/components/landing-page";
import {
  getLandingContent,
  type LandingLocale,
  type PublicPlan,
} from "@/features/landing/content";
import { ogAlt, ogSize } from "@/features/landing/og/meta";

// Page-level openGraph replaces the root one, so reference the generated
// (build-time) share images explicitly.
const ogImage = { url: "/opengraph-image", ...ogSize, alt: ogAlt };

const PATHS: Record<LandingLocale, string> = { tr: "/", en: "/en" };

export function landingMetadata(locale: LandingLocale): Metadata {
  const c = getLandingContent(locale);
  return {
    title: { absolute: c.meta.title },
    description: c.meta.description,
    keywords: locale === "tr" ? [...site.keywords] : undefined,
    alternates: {
      canonical: PATHS[locale],
      languages: { tr: PATHS.tr, en: PATHS.en, "x-default": PATHS.tr },
    },
    openGraph: {
      type: "website",
      url: PATHS[locale],
      siteName: site.name,
      locale: c.meta.ogLocale,
      alternateLocale: locale === "tr" ? ["en_US"] : ["tr_TR"],
      title: c.meta.title,
      description: c.meta.description,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: c.meta.title,
      description: c.meta.description,
      images: [{ ...ogImage, url: "/twitter-image" }],
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Public plans for the pricing section. Revalidated every 5 minutes; when the
 * API is unreachable (e.g. at build time) the section shows only the trial.
 */
async function fetchPublicPlans(): Promise<PublicPlan[]> {
  try {
    const res = await fetch(`${upstreamConfig.baseUrl}/public/billing/plans`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: PublicPlan[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

function structuredData(locale: LandingLocale) {
  const c = getLandingContent(locale);
  const lang = locale === "tr" ? "tr-TR" : "en-US";
  const orgId = `${site.url}/#organization`;
  const pageUrl = `${site.url}${PATHS[locale] === "/" ? "" : PATHS[locale]}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: site.name,
        url: site.url,
        logo: `${site.url}/icon.svg`,
      },
      {
        "@type": "WebSite",
        "@id": `${site.url}/#website`,
        url: pageUrl,
        name: site.name,
        inLanguage: lang,
        publisher: { "@id": orgId },
      },
      {
        "@type": "SoftwareApplication",
        name: site.name,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: c.meta.appCategory,
        operatingSystem: "Web, iOS, Android",
        url: pageUrl,
        description: c.meta.description,
        inLanguage: lang,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "TRY",
          description: c.meta.offer,
        },
        publisher: { "@id": orgId },
      },
      {
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: c.faqs.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

export async function LandingRoute({ locale }: { locale: LandingLocale }) {
  const plans = await fetchPublicPlans();
  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so the JSON cannot close the script tag.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData(locale)).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />
      <LandingPage content={getLandingContent(locale)} plans={plans} />
    </>
  );
}
