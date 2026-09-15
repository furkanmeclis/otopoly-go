"use client";

import { useParams } from "next/navigation";

import { SupplierDetailPage } from "@/features/suppliers";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <SupplierDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
