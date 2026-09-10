"use client";

import { useParams } from "next/navigation";

import { JobDetailPage } from "@/features/jobs";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <JobDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
