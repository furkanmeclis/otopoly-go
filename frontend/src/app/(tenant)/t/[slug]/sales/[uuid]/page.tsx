"use client";

import { useParams } from "next/navigation";

import { SaleDetailPage } from "@/features/sales";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <SaleDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
