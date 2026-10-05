import type { Metadata } from "next";

import { site } from "@/config/site";
import { BetaLandingPage } from "@/features/beta-landing/components/beta-landing-page";
import { getBetaLandingContent } from "@/features/beta-landing/content";
import {
  getLandingContent,
  type LandingLocale,
} from "@/features/landing/content";
import { fetchPublicPlans } from "@/features/landing/server";

const PATHS: Record<LandingLocale, string> = {
  tr: "/beta-landing",
  en: "/en/beta-landing",
};

export function betaLandingMetadata(locale: LandingLocale): Metadata {
  const c = getBetaLandingContent(locale);
  return {
    title: { absolute: c.meta.title },
    description: c.meta.description,
    alternates: {
      canonical: PATHS[locale],
      languages: { tr: PATHS.tr, en: PATHS.en, "x-default": PATHS.tr },
    },
    openGraph: {
      type: "website",
      url: PATHS[locale],
      siteName: site.name,
      locale: locale === "tr" ? "tr_TR" : "en_US",
      alternateLocale: locale === "tr" ? ["en_US"] : ["tr_TR"],
      title: c.meta.title,
      description: c.meta.description,
    },
    twitter: {
      card: "summary_large_image",
      title: c.meta.title,
      description: c.meta.description,
    },
    robots: { index: false, follow: false },
  };
}

export async function BetaLandingRoute({ locale }: { locale: LandingLocale }) {
  const plans = await fetchPublicPlans();
  return (
    <BetaLandingPage
      betaContent={getBetaLandingContent(locale)}
      landingContent={getLandingContent(locale)}
      plans={plans}
    />
  );
}
