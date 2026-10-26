"use client";

import { EntityPage, EntitySectionCard } from "@/components/entity";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { ConnectGuide } from "@/features/mcp/components/connect-guide";
import { ConnectedAppsTable } from "@/features/mcp/components/connected-apps-table";
import { McpClientsTable } from "@/features/mcp/components/mcp-clients-table";
import { McpToolsSummary } from "@/features/mcp/components/mcp-tools-summary";
import { useMcpInfo } from "@/features/mcp/hooks/use-mcp";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

/**
 * Platform → MCP: the /mcp/platform URL with setup steps, the admin's own
 * platform connections and every registered client (platform.mcp.manage).
 */
export function PlatformMcpPage() {
  const { t } = useLocale();
  const { can } = usePermission();
  const info = useMcpInfo();
  const canConnect = can(permissions.mcp.platformConnect);
  const canManage = can(permissions.mcp.manage);

  return (
    <EntityPage
      title={t("mcp.platform.title")}
      description={t("mcp.platform.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.platform.home },
        { label: t("mcp.platform.title") },
      ]}
      permission={[permissions.mcp.platformConnect, permissions.mcp.manage]}
      permissionMode="any"
    >
      <div className="space-y-4">
        {canConnect ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
              <ConnectGuide
                kind="platform"
                url={info.data?.platform_url}
                loading={info.isLoading}
              />
              <McpToolsSummary kind="platform" />
            </div>
            <EntitySectionCard title={t("mcp.platform.connections_title")}>
              <ConnectedAppsTable realm="platform" />
            </EntitySectionCard>
          </>
        ) : null}
        {canManage ? (
          <EntitySectionCard title={t("mcp.clients.title")}>
            <p className="text-muted-foreground mb-3 text-xs">
              {t("mcp.clients.hint")}
            </p>
            <McpClientsTable />
          </EntitySectionCard>
        ) : null}
      </div>
    </EntityPage>
  );
}
