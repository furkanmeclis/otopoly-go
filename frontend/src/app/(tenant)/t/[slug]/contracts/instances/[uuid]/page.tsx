"use client";

import { useParams } from "next/navigation";

import { ContractInstanceDetailPage } from "@/features/contracts";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <ContractInstanceDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
