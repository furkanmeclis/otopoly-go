"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";

import { AppLayout } from "@/components/layout";
import { TenantOrganizationContext } from "@/features/organizations/components/tenant-organization-context";
import { TenantRouteGuard } from "@/features/organizations/components/tenant-route-guard";
import { TenantProvider } from "@/features/organizations/providers/tenant-provider";

export default function TenantLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? "");

  return (
    <TenantProvider slug={slug}>
      <TenantRouteGuard mode="tenant">
        <TenantOrganizationContext slug={slug}>
          <AppLayout variant="tenant" tenantSlug={slug}>
            {children}
          </AppLayout>
        </TenantOrganizationContext>
      </TenantRouteGuard>
    </TenantProvider>
  );
}
