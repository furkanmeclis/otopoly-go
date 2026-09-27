"use client";

import Link from "next/link";
import { useMemo } from "react";

import { AppSidebarLogo } from "@/components/brand";
import type { AppLayoutVariant } from "@/components/layout/app-layout";
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { cmsNav, platformNav, tenantNav } from "@/config/nav";
import { routes } from "@/config/routes";
import { useAIStatus } from "@/features/ai/hooks/use-ai-status";
import { NavEngine } from "@/features/nav-engine";

export function AppSidebar({
  variant = "platform",
  tenantSlug,
}: {
  variant?: AppLayoutVariant;
  tenantSlug?: string;
}) {
  const aiStatus = useAIStatus(tenantSlug ?? "");
  const catalog = useMemo(() => {
    if (variant === "tenant" && tenantSlug) {
      const next = tenantNav(tenantSlug);
      if (aiStatus.status && !aiStatus.status.available) {
        return {
          ...next,
          groups: next.groups.map((group) => ({
            ...group,
            items: group.items.filter((item) => item.id !== "assistant"),
          })),
        };
      }
      return next;
    }
    if (variant === "cms") return cmsNav;
    return platformNav;
  }, [aiStatus.status, tenantSlug, variant]);

  const homeHref =
    variant === "platform"
      ? routes.platform.home
      : variant === "tenant" && tenantSlug
        ? routes.tenant.home(tenantSlug)
        : routes.cms.home;

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={homeHref}>
                <AppSidebarLogo />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <NavEngine catalog={catalog} homeHref={homeHref} />

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
