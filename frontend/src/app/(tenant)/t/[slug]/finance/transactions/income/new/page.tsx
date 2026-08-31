"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { routes } from "@/config/routes";

export default function Page() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? "");

  useEffect(() => {
    router.replace(
      `${routes.tenant.finance.transactions.root(slug)}?create=income`,
    );
  }, [router, slug]);

  return null;
}
