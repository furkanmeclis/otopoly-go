"use client";

import { FinanceTransactionDetailPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <FinanceTransactionDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
