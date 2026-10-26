"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { LoyaltyPage } from "@/features/loyalty";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <LoyaltyPage slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
