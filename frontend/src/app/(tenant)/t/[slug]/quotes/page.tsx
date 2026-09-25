"use client";

import { useParams } from "next/navigation";

import { QuotesPage } from "@/features/quotes";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <QuotesPage slug={String(params.slug ?? "")} />;
}
