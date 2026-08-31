"use client";

import { FinanceSummaryPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <FinanceSummaryPage slug={String(params.slug ?? "")} />;
}
