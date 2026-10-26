"use client";

import { Info } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  formatQuantity,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import type { ReorderSuggestion } from "@/features/stock-reorder/services/stock-reorder.service";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const URGENCY_TONE = {
  out_of_stock: "danger",
  below_min: "warning",
  low_cover: "warning",
  none: "default",
} as const;

const URGENCY_LABEL_KEYS = {
  out_of_stock: "stock_reorder.urgency.out_of_stock",
  below_min: "stock_reorder.urgency.below_min",
  low_cover: "stock_reorder.urgency.low_cover",
  none: "stock_reorder.urgency.none",
} as const;

export function urgencyLabelKey(urgency: ReorderSuggestion["urgency"]) {
  return URGENCY_LABEL_KEYS[urgency];
}

export function UrgencyBadge({
  urgency,
}: {
  urgency: ReorderSuggestion["urgency"];
}) {
  const { t } = useLocale();
  return (
    <StatusChip
      label={t(URGENCY_LABEL_KEYS[urgency])}
      tone={URGENCY_TONE[urgency]}
    />
  );
}

/** Stock vs minimum: the bar fills up to twice the minimum (or the reorder point). */
export function StockMeter({ item }: { item: ReorderSuggestion }) {
  const { t, locale } = useLocale();
  const stock = parseFinanceAmount(item.stock);
  const min = parseFinanceAmount(item.min_stock);
  const scale = Math.max(min * 2, stock, 1);
  const value = Math.max(0, Math.min(100, (stock / scale) * 100));
  const tone =
    item.urgency === "out_of_stock"
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : item.urgency === "none"
        ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
        : "[&_[data-slot=progress-indicator]]:bg-amber-500";
  return (
    <div className="min-w-[8rem] space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className={cn("font-semibold", stock <= 0 && "text-destructive")}>
          {formatQuantity(item.stock, locale)} {item.unit}
        </span>
        <span className="text-muted-foreground">
          {t("stock_reorder.min_short", {
            value: formatQuantity(item.min_stock, locale),
          })}
        </span>
      </div>
      <Progress
        value={value}
        className={cn("h-1.5", tone)}
        aria-label={t("stock_reorder.columns.stock")}
      />
    </div>
  );
}

const SOURCE_KEYS = {
  product: "stock_reorder.explain.source_product",
  supplier: "stock_reorder.explain.source_supplier",
  organization: "stock_reorder.explain.source_organization",
} as const;

/** Popover with every input of the formula for one suggestion. */
export function ExplainButton({ item }: { item: ReorderSuggestion }) {
  const { t, locale } = useLocale();
  const q = (v: string) => formatQuantity(v, locale);
  const rows: [string, string][] = [
    [
      t("stock_reorder.explain.usage", { days: item.inputs.velocity_days }),
      t("stock_reorder.explain.usage_value", {
        consumed: q(item.inputs.consumed_qty),
        sold: q(item.inputs.sold_qty),
      }),
    ],
    [
      t("stock_reorder.explain.velocity"),
      `${q(item.velocity_per_day)} ${item.unit}`,
    ],
    [
      t("stock_reorder.explain.lead"),
      `${item.inputs.lead_days} · ${t(SOURCE_KEYS[item.inputs.lead_days_source])}`,
    ],
    [
      t("stock_reorder.explain.target"),
      `${item.inputs.target_days} · ${t(
        SOURCE_KEYS[item.inputs.target_days_source],
      )}`,
    ],
    [t("stock_reorder.explain.demand"), q(item.inputs.demand_qty)],
    [t("stock_reorder.columns.stock"), q(item.stock)],
    [t("stock_reorder.explain.min"), q(item.min_stock)],
    [t("stock_reorder.explain.on_order"), q(item.on_order)],
    [t("stock_reorder.explain.raw_need"), q(item.inputs.raw_need)],
  ];
  if (item.pack_size) {
    rows.push([t("stock_reorder.explain.pack"), q(item.pack_size)]);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("stock_reorder.explain.title")}
        >
          <Info className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="end">
        <p className="mb-2 font-semibold">{t("stock_reorder.explain.title")}</p>
        <dl className="space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-3 border-t pt-2 text-xs">
          {t("stock_reorder.explain.formula")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
