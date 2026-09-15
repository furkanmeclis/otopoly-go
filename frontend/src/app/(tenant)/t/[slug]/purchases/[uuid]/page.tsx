"use client";

import { useParams } from "next/navigation";

import { PurchaseDetailPage } from "@/features/purchases";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <PurchaseDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
