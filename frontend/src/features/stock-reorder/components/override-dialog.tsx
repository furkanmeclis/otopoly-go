"use client";

import { useCallback, useState } from "react";

import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStockReorderMutations } from "@/features/stock-reorder/hooks/use-stock-reorder";
import type { ReorderSuggestion } from "@/features/stock-reorder/services/stock-reorder.service";
import { suppliersService } from "@/features/suppliers/services/suppliers.service";
import { useLocale } from "@/providers/locale-provider";

function optInt(value: string): number | null | undefined {
  const raw = value.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Per-product reorder settings: preferred supplier, lead time, target cover, pack size. */
export function ReorderOverrideDialog({
  item,
  onOpenChange,
}: {
  item: ReorderSuggestion | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {item ? (
          <OverrideBody
            key={item.product_uuid}
            item={item}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OverrideBody({
  item,
  onOpenChange,
}: {
  item: ReorderSuggestion;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { setOverride } = useStockReorderMutations();
  const o = item.override;
  const [supplier, setSupplier] = useState(o?.supplier_uuid ?? "");
  const supplierLabel = o?.supplier_name ?? "";
  const [lead, setLead] = useState(
    o?.lead_days != null ? String(o.lead_days) : "",
  );
  const [target, setTarget] = useState(
    o?.target_days != null ? String(o.target_days) : "",
  );
  const [pack, setPack] = useState(o?.pack_size ?? "");
  const [error, setError] = useState<string | null>(null);

  const loadSuppliers = useCallback(async (query: string) => {
    const result = await suppliersService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
    });
    return result.items.map((s) => ({ value: s.uuid, label: s.name }));
  }, []);

  const save = async (clear: boolean) => {
    if (!item) return;
    const leadDays = clear ? null : optInt(lead);
    const targetDays = clear ? null : optInt(target);
    if (
      leadDays === undefined ||
      (leadDays !== null && (leadDays < 0 || leadDays > 180))
    ) {
      setError(t("stock_reorder.settings.validation.lead"));
      return;
    }
    if (
      targetDays === undefined ||
      (targetDays !== null && (targetDays < 1 || targetDays > 365))
    ) {
      setError(t("stock_reorder.settings.validation.target"));
      return;
    }
    const packSize = clear ? null : pack.trim().replace(",", ".") || null;
    if (packSize !== null && !(Number.parseFloat(packSize) > 0)) {
      setError(t("stock_reorder.override.validation.pack"));
      return;
    }
    await setOverride.mutateAsync({
      productUuid: item.product_uuid,
      body: {
        supplier_uuid: clear ? null : supplier || null,
        lead_days: leadDays,
        target_days: targetDays,
        pack_size: packSize,
      },
    });
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("stock_reorder.override.title")}</DialogTitle>
        <DialogDescription>
          {item
            ? t("stock_reorder.override.description", { name: item.name })
            : null}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t("stock_reorder.override.supplier")}</Label>
          <AsyncCombobox
            value={supplier}
            onValueChange={setSupplier}
            loadOptions={loadSuppliers}
            initialOptions={
              supplier && supplierLabel
                ? [{ value: supplier, label: supplierLabel }]
                : undefined
            }
            placeholder={
              item?.supplier && item.supplier.source === "last_purchase"
                ? t("stock_reorder.override.supplier_auto", {
                    name: item.supplier.name,
                  })
                : t("purchases.pick_supplier")
            }
            searchPlaceholder={t("purchases.search_supplier")}
            emptyText={t("purchases.no_suppliers")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ovr-lead">
              {t("stock_reorder.settings.lead_days")}
            </Label>
            <Input
              id="ovr-lead"
              inputMode="numeric"
              value={lead}
              placeholder={item ? String(item.inputs.lead_days) : ""}
              onChange={(e) => setLead(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ovr-target">
              {t("stock_reorder.settings.target_days")}
            </Label>
            <Input
              id="ovr-target"
              inputMode="numeric"
              value={target}
              placeholder={item ? String(item.inputs.target_days) : ""}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ovr-pack">
              {t("stock_reorder.override.pack_size")}
            </Label>
            <Input
              id="ovr-pack"
              inputMode="decimal"
              value={pack}
              placeholder="—"
              onChange={(e) => setPack(e.target.value)}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("stock_reorder.override.hint")}
        </p>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>
      <DialogFooter className="mt-4 gap-2 sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={setOverride.isPending || !item?.override}
          onClick={() => void save(true)}
        >
          {t("stock_reorder.override.reset")}
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={setOverride.isPending}
            onClick={() => void save(false)}
          >
            {setOverride.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
