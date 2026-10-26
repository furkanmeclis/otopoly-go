"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { format, startOfMonth } from "date-fns";
import { MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";

import { AppChart } from "@/components/charts/app-chart";
import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import { EntityTable, EntityToolbar } from "@/components/entity";
import { NetgsmIcon } from "@/components/icons/netgsm-icon";
import { TwilioIcon } from "@/components/icons/twilio-icon";
import { PageHeader } from "@/components/layout/page-header";
import { createColumn } from "@/components/tables";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import {
  smsReportKeys,
  smsReportService,
  type SmsReportOrganization,
} from "@/features/platform-sms/services/sms-report.service";
import { date as formatDate, datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type Tone = "default" | "success" | "warning" | "danger";

const ACCOUNT_TONES: Record<string, Tone> = {
  connected: "success",
  unchecked: "warning",
  error: "danger",
};

export function SmsReportPage() {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const router = useRouter();
  const canRead = can(permissions.platformSms.read);
  const [from, setFrom] = useState(() =>
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const nf = useMemo(
    () => new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US"),
    [locale],
  );

  const query = useQuery({
    queryKey: smsReportKeys.report(from, to),
    queryFn: () => smsReportService.report(from, to),
    enabled: canRead && Boolean(from && to) && from <= to,
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  const chart = useMemo(() => {
    const config: ChartConfig = {
      sent: {
        label: t("messaging.platform_report.sent"),
        color: "var(--chart-2)",
      },
      failed: {
        label: t("messaging.platform_report.failed"),
        color: "var(--chart-5)",
      },
    };
    const rows = (data?.daily ?? []).map((d) => ({
      label: formatDate(d.date, "dd.MM", locale),
      sent: d.sent,
      failed: d.failed,
    }));
    return { config, rows };
  }, [data?.daily, locale, t]);

  const columns = useMemo<ColumnDef<SmsReportOrganization>[]>(
    () => [
      createColumn<SmsReportOrganization>({
        accessorKey: "organization_name",
        labelKey: "messaging.platform_report.columns.organization",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.organization_name}</span>
        ),
      }),
      createColumn<SmsReportOrganization>({
        accessorKey: "provider",
        labelKey: "messaging.platform_report.columns.provider",
        cell: ({ row }) => {
          const p = row.original.provider;
          if (!p) return <span className="text-muted-foreground">—</span>;
          const Icon = p === "twilio" ? TwilioIcon : NetgsmIcon;
          return (
            <span className="flex items-center gap-2">
              <Icon
                className={
                  p === "twilio"
                    ? "size-4 text-[#F22F46]"
                    : "size-4 text-[#0057B8]"
                }
              />
              {t(`messaging.sms.providers.${p}.name`)}
              {row.original.is_active ? (
                <Badge variant="secondary" className="text-[10px]">
                  {t("messaging.channels.status.active")}
                </Badge>
              ) : null}
            </span>
          );
        },
      }),
      createColumn<SmsReportOrganization>({
        accessorKey: "account_status",
        labelKey: "messaging.platform_report.columns.status",
        cell: ({ row }) => {
          const s = row.original.account_status;
          if (!s) return <span className="text-muted-foreground">—</span>;
          return (
            <StatusChip
              label={t(`messaging.platform_report.account_status.${s}`)}
              tone={ACCOUNT_TONES[s] ?? "default"}
            />
          );
        },
      }),
      createColumn<SmsReportOrganization>({
        accessorKey: "sent",
        labelKey: "messaging.platform_report.columns.sent",
        cell: ({ row }) => nf.format(row.original.sent),
      }),
      createColumn<SmsReportOrganization>({
        accessorKey: "failed",
        labelKey: "messaging.platform_report.columns.failed",
        cell: ({ row }) =>
          row.original.failed > 0 ? (
            <span className="text-destructive">
              {nf.format(row.original.failed)}
            </span>
          ) : (
            "0"
          ),
      }),
      createColumn<SmsReportOrganization>({
        accessorKey: "segments",
        labelKey: "messaging.platform_report.columns.segments",
        cell: ({ row }) => nf.format(row.original.segments),
      }),
      createColumn<SmsReportOrganization>({
        accessorKey: "last_sent_at",
        labelKey: "messaging.platform_report.columns.last_sent",
        gridSecondary: true,
        cell: ({ row }) =>
          row.original.last_sent_at ? (
            <span className="whitespace-nowrap">
              {datetime(row.original.last_sent_at, "dd.MM.yyyy HH:mm", locale)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      createColumn<SmsReportOrganization>({
        id: "quota",
        accessorFn: (row) => row.quota_used,
        labelKey: "messaging.platform_report.columns.quota",
        cell: ({ row }) => {
          const { quota_used: used, quota_limit: limit } = row.original;
          if (limit < 0) {
            return (
              <span className="text-muted-foreground text-xs">
                {t("messaging.platform_report.quota_unlimited", {
                  used: nf.format(used),
                })}
              </span>
            );
          }
          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
          return (
            <div className="min-w-32 space-y-1">
              <span className="text-xs">
                {nf.format(used)} / {nf.format(limit)}
              </span>
              <Progress value={pct} className="h-1.5" />
            </div>
          );
        },
      }),
    ],
    [locale, nf, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("messaging.platform_report.forbidden")}
      />
    );
  }

  const stats = [
    { key: "sent", value: data?.totals.sent },
    { key: "failed", value: data?.totals.failed },
    { key: "segments", value: data?.totals.segments },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<MessageSquareText className="size-7" />}
        title={t("messaging.platform_report.title")}
        description={t("messaging.platform_report.description")}
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="sms-report-from">
              {t("messaging.platform_report.from")}
            </Label>
            <DatePicker
              id="sms-report-from"
              value={from}
              onChange={(v) => v && setFrom(v)}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sms-report-to">
              {t("messaging.platform_report.to")}
            </Label>
            <DatePicker
              id="sms-report-to"
              value={to}
              onChange={(v) => v && setTo(v)}
              className="w-44"
            />
          </div>
          {from > to ? (
            <p className="text-destructive text-sm">
              {t("messaging.platform_report.range_invalid")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("messaging.platform_report.error")}
          retryLabel={t("common.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.key}>
            <CardHeader className="pb-2">
              <CardDescription>
                {t(`messaging.platform_report.${s.key}`)}
              </CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {query.isLoading ? (
                  <Skeleton className="h-9 w-24" />
                ) : (
                  nf.format(s.value ?? 0)
                )}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {t("messaging.platform_report.daily")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chart.rows.length === 0 && !query.isLoading ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                {t("messaging.platform_report.empty_period")}
              </p>
            ) : (
              <AppChart
                type="bar"
                data={chart.rows}
                config={chart.config}
                categoryKey="label"
                series={["sent", "failed"]}
                stacked
                showLegend
                height={240}
                valueFormatter={(v) => nf.format(v)}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("messaging.platform_report.by_provider")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.by_provider ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("messaging.platform_report.empty_period")}
              </p>
            ) : null}
            {(data?.by_provider ?? []).map((p) => (
              <div
                key={p.provider}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {p.provider === "twilio" ? (
                    <TwilioIcon className="size-5 text-[#F22F46]" />
                  ) : p.provider === "netgsm" ? (
                    <NetgsmIcon className="size-5 text-[#0057B8]" />
                  ) : null}
                  {p.provider === "unknown"
                    ? t("messaging.platform_report.provider_unknown")
                    : t(`messaging.sms.providers.${p.provider}.name`)}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("messaging.platform_report.provider_line", {
                    sent: nf.format(p.sent),
                    failed: nf.format(p.failed),
                    segments: nf.format(p.segments),
                  })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("messaging.platform_report.organizations")}
          </CardTitle>
          <CardDescription>
            {t("messaging.platform_report.organizations_hint")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntityTable
            columns={columns}
            data={data?.organizations ?? []}
            getRowId={(row) => row.organization_uuid}
            isLoading={query.isLoading}
            emptyTitle={t("messaging.platform_report.empty_title")}
            emptyDescription={t("messaging.platform_report.empty_description")}
            onRowClick={(row) =>
              router.push(
                routes.platform.smsReport.organization(row.organization_uuid),
              )
            }
            features={{ columnFilters: false, facetedFilters: false }}
            toolbarExtra={
              <EntityToolbar
                onRefresh={() => void query.refetch()}
                refreshDisabled={query.isFetching}
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
