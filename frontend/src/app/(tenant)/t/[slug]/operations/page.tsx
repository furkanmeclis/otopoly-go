"use client";

import { useParams } from "next/navigation";

import { JobsPage } from "@/features/jobs";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <JobsPage slug={String(params.slug ?? "")} />;
}
