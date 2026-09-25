"use client";

import { useParams } from "next/navigation";

import { QuoteDetailPage } from "@/features/quotes";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <QuoteDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
