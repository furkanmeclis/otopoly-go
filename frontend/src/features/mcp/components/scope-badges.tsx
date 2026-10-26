"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/providers/locale-provider";

/** Read / write access badges of an MCP connection. */
export function ScopeBadges({ scopes }: { scopes: string[] }) {
  const { t } = useLocale();
  const write = scopes.includes("mcp:write");
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="secondary">{t("mcp.scopes.read_short")}</Badge>
      {write ? (
        <Badge variant="warning">{t("mcp.scopes.write_short")}</Badge>
      ) : null}
    </div>
  );
}
