"use client";

import { useParams } from "next/navigation";

import { CategoryDetailPage } from "@/features/catalog";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <CategoryDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
