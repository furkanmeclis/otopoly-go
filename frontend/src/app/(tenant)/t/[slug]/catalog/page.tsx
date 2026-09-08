"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { routes } from "@/config/routes";

export default function CatalogIndexPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params?.slug) {
      router.replace(routes.tenant.catalog.products.root(params.slug));
    }
  }, [params?.slug, router]);

  return null;
}
