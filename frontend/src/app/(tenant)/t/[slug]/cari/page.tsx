"use client";

import { useParams } from "next/navigation";

import { CariPage } from "@/features/cari";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <CariPage slug={String(params.slug ?? "")} />;
}
