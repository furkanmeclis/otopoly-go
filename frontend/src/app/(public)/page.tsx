import type { Metadata } from "next";

import { site } from "@/config/site";
import { LandingPage } from "@/features/landing";
import { faqs } from "@/features/landing/content";
import { ogAlt, ogSize } from "@/features/landing/og/meta";

// Page-level openGraph replaces the root one, so reference the generated
// (build-time) share images explicitly.
const ogImage = { url: "/opengraph-image", ...ogSize, alt: ogAlt };

export const metadata: Metadata = {
  title: { absolute: site.title },
  description: site.description,
  keywords: [...site.keywords],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: site.name,
    locale: site.locale,
    title: site.title,
    description: site.description,
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [{ ...ogImage, url: "/twitter-image" }],
  },
  robots: { index: true, follow: true },
};

function structuredData() {
  const orgId = `${site.url}/#organization`;
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
        url: site.url,
        name: site.name,
        inLanguage: "tr-TR",
        publisher: { "@id": orgId },
      },
      {
        "@type": "SoftwareApplication",
        name: site.name,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Oto yıkama ve detailing işletme yönetimi",
        operatingSystem: "Web, iOS, Android",
        url: site.url,
        description: site.description,
        inLanguage: "tr-TR",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "TRY",
          description: "14 gün ücretsiz deneme",
        },
        publisher: { "@id": orgId },
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

export default function PublicHomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so the JSON cannot close the script tag.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData()).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage />
    </>
  );
}
