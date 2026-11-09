import type { MetadataRoute } from "next";

import { routes } from "@/config/routes";
import { site } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${site.url}${routes.public.root}`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages: { tr: `${site.url}/`, en: `${site.url}/en` } },
    },
    {
      url: `${site.url}/en`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${site.url}${routes.public.register}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${site.url}${routes.public.privacy}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
      alternates: {
        languages: {
          tr: `${site.url}${routes.public.privacy}`,
          en: `${site.url}${routes.public.privacyEn}`,
        },
      },
    },
    {
      url: `${site.url}${routes.public.privacyEn}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${site.url}${routes.public.terms}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
      alternates: {
        languages: {
          tr: `${site.url}${routes.public.terms}`,
          en: `${site.url}${routes.public.termsEn}`,
        },
      },
    },
    {
      url: `${site.url}${routes.public.termsEn}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${site.url}${routes.public.support}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
      alternates: {
        languages: {
          tr: `${site.url}${routes.public.support}`,
          en: `${site.url}${routes.public.supportEn}`,
        },
      },
    },
    {
      url: `${site.url}${routes.public.supportEn}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${site.url}${routes.public.accountDelete}`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
      alternates: {
        languages: {
          tr: `${site.url}${routes.public.accountDelete}`,
          en: `${site.url}${routes.public.accountDeleteEn}`,
        },
      },
    },
    {
      url: `${site.url}${routes.public.accountDeleteEn}`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
