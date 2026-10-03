import type { MetadataRoute } from "next";

import { site } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/register"],
        disallow: ["/api/", "/t/", "/platform/", "/profile/", "/share/", "/onboarding/"],
      },
    ],
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
