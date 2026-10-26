"use client";

import { useMemo } from "react";

import { AppChart } from "@/components/charts/app-chart";
import { useLocale } from "@/providers/locale-provider";

export type EntityTrendPoint = {
  /** YYYY-MM */
  month: string;
  [key: string]: string | number | undefined;
};

export type EntityTrendSeries = {
  key: string;
  label: string;
  color?: string;
};

/**
 * 12-month bar trend of a 360° detail page (revenue, usage, spend). All-zero
 * data renders the chart's empty state instead of a flat line.
 */
export function EntityTrendChart({
  title,
  description,
  points,
  series,
  valueFormatter,
  tickValueFormatter,
  stacked,
  emptyTitle,
  height = 220,
  className,
}: {
  title: string;
  description?: string;
  points: EntityTrendPoint[] | undefined;
  series: EntityTrendSeries[];
  valueFormatter?: (value: number) => string;
  tickValueFormatter?: (value: number) => string;
  stacked?: boolean;
  emptyTitle?: string;
  height?: number;
  className?: string;
}) {
  const { locale } = useLocale();
  const data = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", {
      month: "short",
    });
    const rows = (points ?? []).map((p) => {
      const [y, m] = p.month.split("-").map(Number);
      const row: Record<string, unknown> = {
        label: fmt.format(new Date(Date.UTC(y, (m || 1) - 1, 15))),
      };
      for (const s of series) {
        row[s.key] = Number.parseFloat(String(p[s.key] ?? 0)) || 0;
      }
      return row;
    });
    const any = rows.some((r) => series.some((s) => Number(r[s.key]) !== 0));
    return any ? rows : [];
  }, [points, series, locale]);

  const config = useMemo(
    () =>
      Object.fromEntries(
        series.map((s, i) => [
          s.key,
          { label: s.label, color: s.color ?? `var(--chart-${i + 1})` },
        ]),
      ),
    [series],
  );

  return (
    <AppChart
      type="bar"
      title={title}
      description={description}
      data={data}
      config={config}
      categoryKey="label"
      series={series.map((s) => ({
        key: s.key,
        stackId: stacked ? "a" : undefined,
      }))}
      showLegend={series.length > 1}
      valueFormatter={valueFormatter}
      tickValueFormatter={tickValueFormatter}
      emptyTitle={emptyTitle}
      height={height}
      className={className}
    />
  );
}
