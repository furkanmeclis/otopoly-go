"use client";

import { FinanceAccountDetailPage } from "@/features/finance";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams<{ slug: string; uuid: string }>();
  return (
    <FinanceAccountDetailPage
      slug={String(params.slug ?? "")}
      uuid={String(params.uuid ?? "")}
    />
  );
}
