"use client";

import { useParams } from "next/navigation";

import { CustomersPage } from "@/features/customers";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <CustomersPage slug={String(params.slug ?? "")} />;
}
