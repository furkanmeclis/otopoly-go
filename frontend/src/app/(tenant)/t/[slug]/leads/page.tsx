"use client";

import { useParams } from "next/navigation";

import { LeadsPage } from "@/features/leads";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <LeadsPage slug={String(params.slug ?? "")} />;
}
