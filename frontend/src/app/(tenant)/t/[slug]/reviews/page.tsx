"use client";

import { useParams } from "next/navigation";

import { ReviewsPage } from "@/features/reviews";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <ReviewsPage slug={String(params.slug ?? "")} />;
}
