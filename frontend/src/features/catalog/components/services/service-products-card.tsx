"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EntitySectionCard } from "@/components/entity";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  catalogQueryKeys,
  useServiceProducts,
} from "@/features/catalog/hooks/use-catalog-queries";
import { loadProductOptions } from "@/features/catalog/lib/product-options";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import {
  catalogService,
  type CatalogService,
  type ServiceProduct,
} from "@/features/catalog/services/catalog.service";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type Draft = {
  product_uuid: string;
  name: string;
  unit: string;
  qty: string;
  cost: string;
};

function toDraft(p: ServiceProduct): Draft {
  return {
    product_uuid: p.product_uuid,
    name: p.name,
    unit: p.unit,
    qty: p.qty,
    cost: p.cost_price,
  };
}

const num = (v: string) => Number.parseFloat(String(v).replace(",", ".")) || 0;

/**
 * Recipe: products one unit of this service uses. Every job line of the
 * service takes them out of stock automatically.
 */
export function ServiceProductsCard({
  service,
  canWrite,
}: {
  service: CatalogService;
  canWrite: boolean;
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const query = useServiceProducts(service.uuid);
  const saved = useMemo(() => query.data?.items ?? [], [query.data]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [picker, setPicker] = useState("");
  const [saving, setSaving] = useState(false);

  const loadOptions = useCallback(
    (q: string) => loadProductOptions(q, t, locale),
    [t, locale],
  );

  const rows = editing ? draft : saved.map(toDraft);
  const cost = rows.reduce((sum, r) => sum + num(r.qty) * num(r.cost), 0);
  const price = num(service.price);
  const money = (v: number) =>
    formatFinanceAmount(v.toFixed(2), service.currency, locale);

  const addProduct = async (uuid: string) => {
    setPicker("");
    if (!uuid || draft.some((d) => d.product_uuid === uuid)) return;
    const p = await catalogService.getProduct(uuid);
    setDraft((prev) => [
      ...prev,
      {
        product_uuid: p.uuid,
        name: p.name,
        unit: p.unit,
        qty: "1",
        cost: p.cost_price,
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await catalogService.setServiceProducts(
        service.uuid,
        draft.map((d) => ({ product_uuid: d.product_uuid, qty: d.qty })),
      );
      queryClient.setQueryData(
        catalogQueryKeys.serviceProducts(service.uuid),
        res,
      );
      setEditing(false);
      toast.success(t("catalog.recipe.saved"));
    } catch (err) {
      toast.error((err as Error).message || t("catalog.recipe.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntitySectionCard title={t("catalog.recipe.title")} badge={saved.length}>
      <p className="text-muted-foreground -mt-1 mb-3 text-xs">
        {t("catalog.recipe.hint")}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("catalog.recipe.empty")}
        </p>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {rows.map((r, i) => {
            const stock = saved.find((s) => s.product_uuid === r.product_uuid);
            return (
              <li
                key={r.product_uuid}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatFinanceAmount(r.cost, service.currency, locale)} /{" "}
                    {catalogUnitLabel(t, r.unit)}
                    {stock?.track_stock
                      ? ` · ${t("catalog.products.stock_quantity")}: ${formatQuantity(stock.stock_quantity, locale)}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {editing ? (
                    <Input
                      value={r.qty}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev.map((d, j) =>
                            j === i ? { ...d, qty: e.target.value } : d,
                          ),
                        )
                      }
                      inputMode="decimal"
                      className="h-8 w-16 text-right tabular-nums"
                      aria-label={t("jobs.consumptions.qty")}
                    />
                  ) : (
                    <span className="tabular-nums">
                      {formatQuantity(r.qty, locale)}
                    </span>
                  )}
                  <span className="text-muted-foreground w-12 text-xs">
                    {catalogUnitLabel(t, r.unit)}
                  </span>
                  <span className="w-24 text-right font-medium tabular-nums">
                    {money(num(r.qty) * num(r.cost))}
                  </span>
                  {editing ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive size-8"
                      onClick={() =>
                        setDraft((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <div className="mt-3">
          <AsyncCombobox
            value={picker}
            onValueChange={(v) => void addProduct(v)}
            loadOptions={loadOptions}
            placeholder={t("jobs.consumptions.pick_product")}
            searchPlaceholder={t("sales.search_product")}
            emptyText={t("sales.no_products")}
            hideSelected
            selectedValues={draft.map((d) => d.product_uuid)}
          />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <dl className="bg-muted/40 mt-3 grid grid-cols-3 gap-2 rounded-lg px-3 py-2 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("catalog.recipe.cost")}
            </dt>
            <dd className="font-semibold tabular-nums">{money(cost)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("catalog.services.price")}
            </dt>
            <dd className="font-semibold tabular-nums">{money(price)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("jobs.consumptions.margin")}
            </dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                price - cost >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {money(price - cost)}
            </dd>
          </div>
        </dl>
      ) : null}

      {canWrite ? (
        <div className="mt-3 flex justify-end gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("common.save")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(saved.map(toDraft));
                setEditing(true);
              }}
            >
              <Plus className="size-4" />
              {saved.length
                ? t("catalog.recipe.edit")
                : t("catalog.recipe.add")}
            </Button>
          )}
        </div>
      ) : null}
    </EntitySectionCard>
  );
}
