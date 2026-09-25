"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { TodosPage } from "@/features/todos";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <TodosPage slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
