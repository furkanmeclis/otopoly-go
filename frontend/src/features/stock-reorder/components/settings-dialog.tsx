"use client";

import { Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useReorderSettings,
  useStockReorderMutations,
} from "@/features/stock-reorder/hooks/use-stock-reorder";
import type { ReorderSettings } from "@/features/stock-reorder/services/stock-reorder.service";
import { suppliersService } from "@/features/suppliers/services/suppliers.service";
import { useLocale } from "@/providers/locale-provider";

type LeadRow = {
  supplier_uuid: string;
  supplier_name: string;
  lead_days: string;
};

function toInt(value: string, fallback: number) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Organization reorder settings: usage window, lead time, target cover, daily notification, supplier lead times. */
export function ReorderSettingsDialog({
  open,
  onOpenChange,
  canWrite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const settingsQuery = useReorderSettings(open);
  const data = settingsQuery.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {data ? (
          <SettingsBody
            key={settingsQuery.dataUpdatedAt}
            data={data}
            canWrite={canWrite}
            onOpenChange={onOpenChange}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("stock_reorder.settings.title")}</DialogTitle>
              <DialogDescription>
                {t("stock_reorder.settings.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody({
  data,
  canWrite,
  onOpenChange,
}: {
  data: ReorderSettings;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { updateSettings } = useStockReorderMutations();
  const [velocity, setVelocity] = useState(String(data.velocity_days));
  const [lead, setLead] = useState(String(data.lead_days));
  const [target, setTarget] = useState(String(data.target_days));
  const [notify, setNotify] = useState(data.notify_enabled);
  const [leads, setLeads] = useState<LeadRow[]>(() =>
    data.supplier_lead_days.map((row) => ({
      supplier_uuid: row.supplier_uuid,
      supplier_name: row.supplier_name ?? "",
      lead_days: String(row.lead_days),
    })),
  );
  const [picker, setPicker] = useState("");
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

  const addSupplier = useCallback(
    async (uuid: string) => {
      setPicker("");
      if (!uuid || leads.some((row) => row.supplier_uuid === uuid)) return;
      const supplier = await suppliersService.get(uuid).catch(() => null);
      setLeads((prev) => [
        ...prev,
        {
          supplier_uuid: uuid,
          supplier_name: supplier?.name ?? "",
          lead_days: lead,
        },
      ]);
    },
    [lead, leads],
  );

  const save = async () => {
    const leadDays = toInt(lead, -1);
    const targetDays = toInt(target, -1);
    if (leadDays < 0 || leadDays > 180) {
      setError(t("stock_reorder.settings.validation.lead"));
      return;
    }
    if (targetDays < 1 || targetDays > 365) {
      setError(t("stock_reorder.settings.validation.target"));
      return;
    }
    const supplierLeads = leads.map((row) => ({
      supplier_uuid: row.supplier_uuid,
      lead_days: toInt(row.lead_days, -1),
    }));
    if (supplierLeads.some((row) => row.lead_days < 0 || row.lead_days > 180)) {
      setError(t("stock_reorder.settings.validation.lead"));
      return;
    }
    await updateSettings.mutateAsync({
      velocity_days: toInt(velocity, 30),
      lead_days: leadDays,
      target_days: targetDays,
      notify_enabled: notify,
      supplier_lead_days: supplierLeads,
    });
    onOpenChange(false);
  };

  const options = data.velocity_day_options;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("stock_reorder.settings.title")}</DialogTitle>
        <DialogDescription>
          {t("stock_reorder.settings.description")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t("stock_reorder.settings.velocity_days")}</Label>
          <Select
            value={velocity}
            onValueChange={setVelocity}
            disabled={!canWrite}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {t("stock_reorder.settings.days_option", { count: days })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {t("stock_reorder.settings.velocity_hint")}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reorder-lead">
              {t("stock_reorder.settings.lead_days")}
            </Label>
            <Input
              id="reorder-lead"
              inputMode="numeric"
              value={lead}
              disabled={!canWrite}
              onChange={(e) => setLead(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reorder-target">
              {t("stock_reorder.settings.target_days")}
            </Label>
            <Input
              id="reorder-target"
              inputMode="numeric"
              value={target}
              disabled={!canWrite}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">
              {t("stock_reorder.settings.notify")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("stock_reorder.settings.notify_hint", {
                time: data.notify_time,
              })}
            </p>
          </div>
          <Switch
            checked={notify}
            onCheckedChange={setNotify}
            disabled={!canWrite}
            aria-label={t("stock_reorder.settings.notify")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("stock_reorder.settings.supplier_leads")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("stock_reorder.settings.supplier_leads_hint")}
          </p>
          {leads.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {leads.map((row) => (
                <li
                  key={row.supplier_uuid}
                  className="flex items-center gap-2 p-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {row.supplier_name || row.supplier_uuid}
                  </span>
                  <Input
                    className="h-8 w-20 tabular-nums"
                    inputMode="numeric"
                    value={row.lead_days}
                    disabled={!canWrite}
                    aria-label={t("stock_reorder.settings.lead_days")}
                    onChange={(e) =>
                      setLeads((prev) =>
                        prev.map((r) =>
                          r.supplier_uuid === row.supplier_uuid
                            ? { ...r, lead_days: e.target.value }
                            : r,
                        ),
                      )
                    }
                  />
                  <span className="text-muted-foreground text-xs">
                    {t("stock_reorder.days")}
                  </span>
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t("common.delete")}
                      onClick={() =>
                        setLeads((prev) =>
                          prev.filter(
                            (r) => r.supplier_uuid !== row.supplier_uuid,
                          ),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canWrite ? (
            <AsyncCombobox
              value={picker}
              onValueChange={(value) => void addSupplier(value)}
              loadOptions={loadSuppliers}
              placeholder={t("stock_reorder.settings.add_supplier")}
              searchPlaceholder={t("purchases.search_supplier")}
              emptyText={t("purchases.no_suppliers")}
              hideSelected
              selectedValues={leads.map((row) => row.supplier_uuid)}
            />
          ) : null}
        </div>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>
      <DialogFooter className="mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        {canWrite ? (
          <Button
            type="button"
            disabled={updateSettings.isPending}
            onClick={() => void save()}
          >
            {updateSettings.isPending ? t("common.saving") : t("common.save")}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
