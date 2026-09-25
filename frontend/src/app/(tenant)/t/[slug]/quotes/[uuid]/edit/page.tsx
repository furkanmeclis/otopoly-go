"use client";

import { useParams } from "next/navigation";

import { QuoteEditorPage } from "@/features/quotes";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <QuoteEditorPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
