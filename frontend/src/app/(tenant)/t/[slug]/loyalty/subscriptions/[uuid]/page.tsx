"use client";

import { useParams } from "next/navigation";

import { SubscriptionDetailPage } from "@/features/loyalty";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <SubscriptionDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
