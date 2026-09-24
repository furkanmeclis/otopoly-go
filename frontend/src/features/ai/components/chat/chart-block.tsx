"use client";

import { useMemo } from "react";

import { AppChart } from "@/components/charts/app-chart";
import type { ChartType } from "@/components/charts/types";
import type { ChartConfig } from "@/components/ui/chart";
import type { AIChart } from "@/features/ai/types";
import { useLocale } from "@/providers/locale-provider";

const CHART_TYPES: Record<string, ChartType> = {
  line: "line",
  bar: "bar",
  area: "area",
  pie: "donut",
};

/** Renders an assistant chart block with AppChart. Series keys are remapped to
 * CSS-safe ids (s0, s1, …) because AppChart uses them in CSS variables. */
export function ChartBlock({ chart }: { chart: AIChart }) {
  const { locale } = useLocale();

  const { data, config, series } = useMemo(() => {
    const cfg: ChartConfig = {};
    const keys = chart.series.map((s, i) => {
      const key = `s${i}`;
      cfg[key] = {
        label: s.label || s.key,
        color: `var(--chart-${(i % 5) + 1})`,
      };
      return { key, source: s.key };
    });
    const rows = chart.rows.map((row) => {
      const out: Record<string, unknown> = {
        label: String(row[chart.x_key] ?? ""),
      };
      for (const k of keys) {
        const v = Number(row[k.source]);
        out[k.key] = Number.isFinite(v) ? v : 0;
      }
      return out;
    });
    return { data: rows, config: cfg, series: keys.map((k) => k.key) };
  }, [chart]);

  const formatter = useMemo(() => {
    const nf = locale === "tr" ? "tr-TR" : "en-US";
    if (chart.value_format === "currency") {
      const fmt = new Intl.NumberFormat(nf, {
        style: "currency",
        currency: chart.currency || "TRY",
        maximumFractionDigits: 0,
      });
      return (v: number) => fmt.format(v);
    }
    if (chart.value_format === "percent") {
      return (v: number) => `%${v.toLocaleString(nf)}`;
    }
    const fmt = new Intl.NumberFormat(nf, { maximumFractionDigits: 2 });
    return (v: number) => fmt.format(v);
  }, [chart.currency, chart.value_format, locale]);

  const type = CHART_TYPES[chart.type] ?? "bar";

  return (
    <AppChart
      type={type}
      title={chart.title}
      data={data}
      config={config}
      categoryKey="label"
      series={series}
      valueFormatter={formatter}
      height={220}
      showLegend={type === "donut" || series.length > 1}
      className="bg-background"
    />
  );
}
