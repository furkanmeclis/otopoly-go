"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { AssistantPage } from "@/features/ai";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <AssistantPage slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
