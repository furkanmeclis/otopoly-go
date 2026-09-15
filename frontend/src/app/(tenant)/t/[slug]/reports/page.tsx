"use client";

import { useParams } from "next/navigation";

import { ReportsPage } from "@/features/reports";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <ReportsPage slug={String(params.slug ?? "")} />;
}
