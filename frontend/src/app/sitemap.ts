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
    },
    {
      url: `${site.url}${routes.public.register}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
