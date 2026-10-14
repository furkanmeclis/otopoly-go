"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";

import { AppLayout } from "@/components/layout";
import { AssistantLauncher } from "@/features/ai";
import { LimitReachedDialog, SubscriptionBanner } from "@/features/billing";
import { TenantOrganizationContext } from "@/features/organizations/components/tenant-organization-context";
import { TenantRouteGuard } from "@/features/organizations/components/tenant-route-guard";
import { TenantProvider } from "@/features/organizations/providers/tenant-provider";

export default function TenantLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? "");
  return (
    <TenantProvider slug={slug}>
      <TenantRouteGuard>
        <TenantOrganizationContext slug={slug}>
          <AppLayout variant="tenant" tenantSlug={slug}>
            <SubscriptionBanner slug={slug} />
            {children}
            <AssistantLauncher slug={slug} />
            <LimitReachedDialog slug={slug} />
          </AppLayout>
        </TenantOrganizationContext>
      </TenantRouteGuard>
    </TenantProvider>
  );
}
