"use client";

import { useParams } from "next/navigation";

import { StaffPage } from "@/features/staff";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <StaffPage slug={String(params.slug ?? "")} />;
}
