"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { TenantDashboard } from "@/features/tenant-dashboard/components/tenant-dashboard";

export default function TenantHomePage() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <TenantDashboard slug={String(params.slug ?? "")} />
    </Suspense>
  );
}
