"use client";

import { useParams } from "next/navigation";

import { ReviewDetailPage } from "@/features/reviews";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <ReviewDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
