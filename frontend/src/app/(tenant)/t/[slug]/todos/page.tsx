"use client";

import { useParams } from "next/navigation";

import { TodosPage } from "@/features/todos";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <TodosPage slug={String(params.slug ?? "")} />;
}
