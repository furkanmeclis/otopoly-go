"use client";

import { EntityPage, EntitySectionCard } from "@/components/entity";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { ConnectGuide } from "@/features/mcp/components/connect-guide";
import { ConnectedAppsTable } from "@/features/mcp/components/connected-apps-table";
import { McpToolsSummary } from "@/features/mcp/components/mcp-tools-summary";
import { useMcpInfo } from "@/features/mcp/hooks/use-mcp";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

/**
 * Business settings → AI connections (MCP): the /mcp/org URL, setup steps
 * for Claude and other clients, and the user's connections to this business.
 */
export function TenantMcpPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const info = useMcpInfo();
  const org = user?.organizations.find((o) => o.slug === slug);

  return (
    <EntityPage
      title={t("mcp.tenant.title")}
      description={t("mcp.tenant.description")}
      breadcrumbs={[
        {
          label: t("layout.breadcrumb_home"),
          href: routes.tenant.home(slug),
        },
        { label: t("layout.section_settings") },
        { label: t("mcp.tenant.title") },
      ]}
      permission={permissions.mcp.connect}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <ConnectGuide
          kind="org"
          url={info.data?.org_url}
          loading={info.isLoading}
        />
        <McpToolsSummary kind="org" />
      </div>
      <div className="mt-4">
        <EntitySectionCard title={t("mcp.tenant.connections_title")}>
          <p className="text-muted-foreground mb-3 text-xs">
            {t("mcp.tenant.connections_hint")}
          </p>
          {org ? (
            <ConnectedAppsTable realm="org" organizationUuid={org.uuid} />
          ) : null}
        </EntitySectionCard>
      </div>
    </EntityPage>
  );
}
