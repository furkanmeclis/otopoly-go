"use client";

import { EntitySectionCard } from "@/components/entity";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/providers/locale-provider";

const ORG_AREAS = [
  "mcp.summary.areas.customers",
  "mcp.summary.areas.jobs",
  "mcp.summary.areas.sales",
  "mcp.summary.areas.finance",
  "mcp.summary.areas.catalog",
  "mcp.summary.areas.todos",
  "mcp.summary.areas.leads",
  "mcp.summary.areas.reports",
] as const;

const PLATFORM_AREAS = [
  "mcp.summary.areas.organizations",
  "mcp.summary.areas.users",
  "mcp.summary.areas.billing",
  "mcp.summary.areas.ai_usage",
  "mcp.summary.areas.logs",
  "mcp.summary.areas.health",
] as const;

/** What an AI client can do over the endpoint, in plain words. */
export function McpToolsSummary({ kind }: { kind: "org" | "platform" }) {
  const { t } = useLocale();
  const areas = kind === "org" ? ORG_AREAS : PLATFORM_AREAS;
  return (
    <EntitySectionCard title={t("mcp.summary.title")}>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t(
            kind === "org"
              ? "mcp.summary.org_intro"
              : "mcp.summary.platform_intro",
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {areas.map((area) => (
            <Badge key={area} variant="secondary">
              {t(area)}
            </Badge>
          ))}
        </div>
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5">
          <li>{t("mcp.summary.rule_permissions")}</li>
          {kind === "org" ? (
            <>
              <li>{t("mcp.summary.rule_one_org")}</li>
              <li>{t("mcp.summary.rule_write")}</li>
            </>
          ) : (
            <li>{t("mcp.summary.rule_read_only")}</li>
          )}
          <li>{t("mcp.summary.rule_audit")}</li>
        </ul>
      </div>
    </EntitySectionCard>
  );
}
