"use client";

import { useCallback, useState } from "react";
import { Loader2, PackageMinus, Plus, Trash2 } from "lucide-react";

import { EntitySectionCard } from "@/components/entity";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadProductOptions } from "@/features/catalog/lib/product-options";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { useJobsMutations } from "@/features/jobs/hooks/use-jobs";
import type {
  JobConsumption,
  JobDetail,
} from "@/features/jobs/services/jobs.service";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/**
 * Products used on the job. Service recipes fill it when the job is
 * created; staff add extras (paspas, koku…) or fix quantities. Tracked
 * products follow stock; cancelling the job gives them back.
 */
export function JobConsumptionsCard({
  job,
  canWrite,
}: {
  job: JobDetail;
  canWrite: boolean;
}) {
  const { t, locale } = useLocale();
  const { consumption } = useJobsMutations();
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("1");
  const editable =
    canWrite && job.status !== "cancelled" && job.status !== "voided";
  const items = job.consumptions ?? [];
  const active = items.filter((c) => !c.reverted);
  const money = (v: string) => formatFinanceAmount(v, job.currency, locale);

  const loadOptions = useCallback(
    (q: string) => loadProductOptions(q, t, locale),
    [t, locale],
  );

  const add = async () => {
    if (!product || !qty.trim()) return;
    await consumption.mutateAsync({
      op: "add",
      uuid: job.uuid,
      product_uuid: product,
      qty: qty.trim(),
    });
    setProduct("");
    setQty("1");
  };

  const margin =
    Number.parseFloat(job.total_amount || "0") -
    Number.parseFloat(job.material_cost || "0");

  return (
    <EntitySectionCard
      title={t("jobs.consumptions.title")}
      badge={active.length}
    >
      <p className="text-muted-foreground -mt-1 mb-3 text-xs">
        {t("jobs.consumptions.hint")}
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("jobs.consumptions.empty")}
        </p>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {items.map((c) => (
            <ConsumptionRow
              key={c.uuid}
              c={c}
              editable={editable && !c.reverted}
              money={money}
              pending={consumption.isPending}
              onQty={(value) =>
                consumption.mutate({
                  op: "update",
                  uuid: job.uuid,
                  consumptionUuid: c.uuid,
                  qty: value,
                })
              }
              onDelete={() =>
                consumption.mutate({
                  op: "delete",
                  uuid: job.uuid,
                  consumptionUuid: c.uuid,
                })
              }
            />
          ))}
        </ul>
      )}

      {editable ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <AsyncCombobox
              value={product}
              onValueChange={setProduct}
              loadOptions={loadOptions}
              placeholder={t("jobs.consumptions.pick_product")}
              searchPlaceholder={t("sales.search_product")}
              emptyText={t("sales.no_products")}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              className="w-20 text-right tabular-nums"
              aria-label={t("jobs.consumptions.qty")}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!product || consumption.isPending}
              onClick={() => void add()}
            >
              {consumption.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t("jobs.consumptions.add")}
            </Button>
          </div>
        </div>
      ) : null}

      {active.length > 0 ? (
        <dl className="bg-muted/40 mt-3 grid grid-cols-2 gap-2 rounded-lg px-3 py-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("jobs.consumptions.material_cost")}
            </dt>
            <dd className="font-semibold tabular-nums">
              {money(job.material_cost)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("jobs.consumptions.service_total")}
            </dt>
            <dd className="font-semibold tabular-nums">
              {money(job.total_amount)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("jobs.consumptions.margin")}
            </dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                margin >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {money(margin.toFixed(2))}
            </dd>
          </div>
        </dl>
      ) : null}
    </EntitySectionCard>
  );
}

function ConsumptionRow({
  c,
  editable,
  money,
  pending,
  onQty,
  onDelete,
}: {
  c: JobConsumption;
  editable: boolean;
  money: (v: string) => string;
  pending: boolean;
  onQty: (value: string) => void;
  onDelete: () => void;
}) {
  const { t, locale } = useLocale();
  const [draft, setDraft] = useState(c.qty);
  const unit = catalogUnitLabel(t, c.unit);
  const commit = () => {
    const v = draft.trim();
    if (!v || v.replace(",", ".") === c.qty) {
      setDraft(c.qty);
      return;
    }
    onQty(v);
  };

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 py-2",
        c.reverted && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <p className={cn("truncate font-medium", c.reverted && "line-through")}>
          {c.name}
        </p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span>
            {c.service_name
              ? t("jobs.consumptions.from_recipe", { service: c.service_name })
              : t("jobs.consumptions.added_by_hand")}
          </span>
          {!c.stock_applied ? (
            <span>· {t("jobs.consumptions.untracked")}</span>
          ) : null}
          {c.reverted ? (
            <span className="flex items-center gap-1">
              · <PackageMinus className="size-3" />
              {t("jobs.consumptions.reverted")}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {editable ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            inputMode="decimal"
            disabled={pending}
            className="h-8 w-16 text-right tabular-nums"
            aria-label={t("jobs.consumptions.qty")}
          />
        ) : (
          <span className="tabular-nums">{formatQuantity(c.qty, locale)}</span>
        )}
        <span className="text-muted-foreground w-12 text-xs">{unit}</span>
        <span className="w-24 text-right font-medium tabular-nums">
          {money(c.total_cost)}
        </span>
        {editable ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive size-8"
            disabled={pending}
            onClick={onDelete}
            aria-label={t("common.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
