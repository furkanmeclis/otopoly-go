"use client";

import { useParams } from "next/navigation";
import { ServicesPage } from "@/features/catalog";

export default function Page() {
  const params = useParams<{ slug: string }>();
  return <ServicesPage slug={String(params.slug ?? "")} />;
}
