"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { JobsPage } from "@/features/jobs";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <JobsPage slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
