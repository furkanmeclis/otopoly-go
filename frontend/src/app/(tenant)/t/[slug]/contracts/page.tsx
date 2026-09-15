"use client";

import { useParams } from "next/navigation";

import { ContractInstancesPage } from "@/features/contracts";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <ContractInstancesPage slug={String(params.slug ?? "")} />;
}
