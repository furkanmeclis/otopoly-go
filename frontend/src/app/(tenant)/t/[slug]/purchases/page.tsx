"use client";

import { useParams } from "next/navigation";

import { PurchasesPage } from "@/features/purchases";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <PurchasesPage slug={String(params.slug ?? "")} />;
}
