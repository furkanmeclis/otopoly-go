"use client";

import { FinanceTransactionsPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <FinanceTransactionsPage slug={String(params.slug ?? "")} />;
}
