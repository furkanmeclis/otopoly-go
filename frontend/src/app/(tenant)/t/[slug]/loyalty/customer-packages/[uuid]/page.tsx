"use client";

import { useParams } from "next/navigation";

import { CustomerPackageDetailPage } from "@/features/loyalty";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <CustomerPackageDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
