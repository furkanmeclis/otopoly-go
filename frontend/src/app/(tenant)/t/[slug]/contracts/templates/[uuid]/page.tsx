"use client";

import { useParams } from "next/navigation";

import { ContractTemplateDetailPage } from "@/features/contracts";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <ContractTemplateDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
