"use client";

import { useParams } from "next/navigation";

import { TenantMcpPage } from "@/features/mcp";

export default function SettingsMcpPage() {
  const params = useParams<{ slug: string }>();
  return <TenantMcpPage slug={String(params.slug ?? "")} />;
}
