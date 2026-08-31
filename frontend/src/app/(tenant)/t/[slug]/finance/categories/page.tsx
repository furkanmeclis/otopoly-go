"use client";

import { FinanceCategoriesPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <FinanceCategoriesPage slug={String(params.slug ?? "")} />;
}
