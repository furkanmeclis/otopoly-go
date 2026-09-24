"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { aiKeys } from "@/features/ai/hooks/query-keys";
import { aiPlatformService } from "@/features/ai/services/ai.service";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import Link from "next/link";

function lastMonths(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function AIUsageTable() {
  const { t, locale } = useLocale();
  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(months[0]);
  const nf = useMemo(
    () => new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US"),
    [locale],
  );
  const usd = useMemo(
    () =>
      new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }),
    [locale],
  );

  const { data, isLoading } = useQuery({
    queryKey: aiKeys.usage(month),
    queryFn: () => aiPlatformService.getUsage(month),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{t("ai.usage.title")}</CardTitle>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t("ai.usage.description")}
          </p>
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-40" aria-label={t("ai.usage.month")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {date(`${m}-01`, "LLLL yyyy", locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t("ai.usage.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    {t("ai.usage.organization")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.requests")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.input")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.output")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.cache")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.quota_tokens")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.quota")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("ai.usage.cost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.organization_uuid} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={routes.platform.organizations.detail(
                          row.organization_uuid,
                        )}
                        className="font-medium hover:underline"
                      >
                        {row.organization_name}
                      </Link>
                      {!row.enabled ? (
                        <Badge variant="outline" className="ml-2">
                          {t("ai.usage.org_disabled")}
                        </Badge>
                      ) : null}
                      <p className="text-muted-foreground text-xs">
                        {row.models.map((m) => m.model).join(", ")}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {nf.format(row.request_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {nf.format(row.input_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {nf.format(row.output_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {nf.format(row.cache_read_tokens)} /{" "}
                      {nf.format(row.cache_write_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {nf.format(row.quota_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.quota_limit === 0
                        ? t("ai.usage.unlimited")
                        : `${Math.min(100, Math.round((row.quota_tokens / row.quota_limit) * 100))}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.models.some((m) => m.estimated_cost_usd != null)
                        ? usd.format(row.estimated_cost_usd)
                        : t("ai.usage.cost_unknown")}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 border-t text-sm font-medium">
                <tr>
                  <td className="px-3 py-2">{t("ai.usage.total")}</td>
                  <td colSpan={4} />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {nf.format(data.total_tokens)}
                  </td>
                  <td />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {data.items.some((row) =>
                      row.models.some((m) => m.estimated_cost_usd != null),
                    )
                      ? usd.format(data.estimated_cost_usd)
                      : t("ai.usage.cost_unknown")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
