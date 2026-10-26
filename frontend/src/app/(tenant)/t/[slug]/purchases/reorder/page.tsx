"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { StockReorderPage } from "@/features/stock-reorder";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <StockReorderPage slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
