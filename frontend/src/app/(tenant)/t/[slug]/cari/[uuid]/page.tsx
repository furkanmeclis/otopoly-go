"use client";

import { useParams } from "next/navigation";

import { CariDetailPage } from "@/features/cari";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <CariDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
