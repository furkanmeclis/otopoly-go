"use client";

import { FinanceCategoryDetailPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <FinanceCategoryDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
