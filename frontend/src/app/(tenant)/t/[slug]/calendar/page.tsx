"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { CalendarPage } from "@/features/calendar";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <CalendarPage slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
