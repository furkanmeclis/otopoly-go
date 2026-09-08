"use client";

import { useParams } from "next/navigation";

import { ServiceDetailPage } from "@/features/catalog";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <ServiceDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
