"use client";

import { useParams } from "next/navigation";

import { SalesPage } from "@/features/sales";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <SalesPage slug={String(params.slug ?? "")} />;
}
