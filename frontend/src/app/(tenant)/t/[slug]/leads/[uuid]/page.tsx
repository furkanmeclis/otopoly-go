"use client";

import { useParams } from "next/navigation";

import { LeadDetailPage } from "@/features/leads";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <LeadDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
