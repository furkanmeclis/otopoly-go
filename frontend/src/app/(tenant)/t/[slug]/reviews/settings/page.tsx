"use client";

import { useParams } from "next/navigation";

import { ReviewSettingsPage } from "@/features/reviews";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <ReviewSettingsPage slug={String(params.slug ?? "")} />;
}
