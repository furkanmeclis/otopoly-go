"use client";

import { FinanceAccountsPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <FinanceAccountsPage slug={String(params.slug ?? "")} />;
}
