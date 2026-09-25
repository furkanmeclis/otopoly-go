"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleSlash,
  Hammer,
} from "lucide-react";
import { useRouter } from "next/navigation";
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
import { routes } from "@/config/routes";
import {
  catalogPickerOptions,
  customersService,
} from "@/features/customers/services/customers.service";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import {
  useConvertPreview,
  useQuoteMutations,
} from "@/features/quotes/hooks/use-quotes";
import type { QuoteDetail } from "@/features/quotes/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const NEW = "__new__";

/** One confirm dialog: shows exactly what the job will contain. */
function ConvertQuoteDialogBody({
  slug,
  quote,
  onOpenChange,
}: {
  slug: string;
  quote: QuoteDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const preview = useConvertPreview(quote.uuid, true);
  const { convert } = useQuoteMutations();
  const [vehicleChoice, setVehicleChoice] = useState("");
  const [plate, setPlate] = useState(quote.vehicle_plate);
  const [catalog, setCatalog] = useState("");
  const loadCatalog = useCallback(async (q: string) => {
    const res = await customersService.searchCatalog(q.trim());
    return catalogPickerOptions(res.items ?? []);
  }, []);

  const p = preview.data;
  const money = (v: string) =>
    formatFinanceAmount(v, p?.currency ?? quote.currency, locale);
  const needsVehicle = Boolean(p && !p.vehicle_uuid && p.missing.length > 0);
  // Default to the customer's first saved vehicle: fewer clicks.
  const choice = vehicleChoice || (p?.customer_vehicles[0]?.uuid ?? NEW);
  const picking = needsVehicle && choice !== NEW;
  const needPlate = needsVehicle && !picking && p?.missing.includes("plate");
  const needModel = needsVehicle && !picking && p?.missing.includes("model");
  const ready =
    Boolean(p?.can_convert) &&
    (!needsVehicle ||
      Boolean(picking) ||
      ((!needPlate || plate.trim().length > 0) &&
        (!needModel || catalog !== "")));

  const submit = () => {
    const [modelUuid, year] = catalog ? catalog.split(":") : [];
    convert.mutate(
      {
        uuid: quote.uuid,
        body: picking
          ? { vehicle_uuid: choice }
          : {
              plate: plate.trim() || undefined,
              model_uuid: modelUuid || null,
              year: year ? Number(year) : null,
            },
      },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          router.push(routes.tenant.operations.detail(slug, res.job_uuid));
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Hammer className="text-primary size-5" />
          {t("quotes.convert.title")}
        </DialogTitle>
        <DialogDescription>{t("quotes.convert.description")}</DialogDescription>
      </DialogHeader>

      {preview.isLoading || !p ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-32" />
        </div>
      ) : !p.can_convert ? (
        <p className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
          {t(`quotes.convert.blocker.${p.blocker ?? "status"}`)}
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          {p.will_accept ? (
            <p className="flex gap-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
              <Check className="size-4 shrink-0" />
              {t("quotes.convert.will_accept")}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
            <div>
              <p className="text-muted-foreground text-xs">
                {t("quotes.fields.customer")}
              </p>
              <p className="font-medium">{p.customer_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">
                {t("quotes.fields.vehicle")}
              </p>
              {p.vehicle_uuid ? (
                <div className="flex flex-wrap items-center gap-1">
                  <PlateBadge plate={p.plate} size="sm" />
                  <span className="text-muted-foreground text-xs">
                    {p.vehicle_label}
                  </span>
                </div>
              ) : p.creates_vehicle ? (
                <div>
                  <PlateBadge plate={p.plate} size="sm" />
                  <p className="text-muted-foreground text-xs">
                    {t("quotes.convert.creates_vehicle")}
                  </p>
                </div>
              ) : (
                <p className="text-amber-600">
                  {t("quotes.convert.vehicle_missing")}
                </p>
              )}
            </div>
          </div>

          {needsVehicle ? (
            <div className="space-y-2 rounded-lg border border-amber-500/40 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4" />
                {t("quotes.convert.vehicle_needed")}
              </p>
              {p.customer_vehicles.length > 0 ? (
                <Select value={choice} onValueChange={setVehicleChoice}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>
                      {t("quotes.convert.new_vehicle")}
                    </SelectItem>
                    {p.customer_vehicles.map((v) => (
                      <SelectItem key={v.uuid} value={v.uuid}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {!picking ? (
                <div className="grid gap-2">
                  {needPlate ? (
                    <div className="space-y-1">
                      <Label className="text-xs">
                        {t("quotes.convert.plate")}
                      </Label>
                      <Input
                        value={plate}
                        onChange={(e) => setPlate(e.target.value.toUpperCase())}
                        maxLength={16}
                        autoFocus
                      />
                    </div>
                  ) : null}
                  {needModel ? (
                    <div className="space-y-1">
                      <Label className="text-xs">
                        {t("quotes.convert.model")}
                      </Label>
                      <AsyncCombobox
                        value={catalog}
                        onValueChange={setCatalog}
                        loadOptions={loadCatalog}
                        placeholder={t("quotes.convert.model_placeholder")}
                        searchPlaceholder={t(
                          "quotes.editor.vehicle_catalog_search",
                        )}
                        emptyText={t("quotes.editor.vehicle_catalog_empty")}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <ul className="divide-y rounded-lg border">
            {p.lines.map((l, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2 px-3 py-2",
                  !l.included && "text-muted-foreground",
                )}
              >
                {l.included ? (
                  <Check className="size-4 shrink-0 text-emerald-600" />
                ) : (
                  <CircleSlash className="size-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate", !l.included && "line-through")}>
                    {l.description}
                  </p>
                  <p className="text-xs">
                    {l.included
                      ? `${l.quantity} × ${money(l.unit_price)}`
                      : t(
                          `quotes.convert.reason.${l.reason ?? "not_a_service"}`,
                        )}
                  </p>
                </div>
                <span className="tabular-nums">{money(l.line_total)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between">
            <span className="font-medium">{t("quotes.convert.job_total")}</span>
            <span className="text-primary text-lg font-semibold tabular-nums">
              {money(p.job_total)}
            </span>
          </div>
          {p.skipped_total !== "0.00" ? (
            <p className="text-muted-foreground text-xs">
              {t("quotes.convert.skipped_note", {
                amount: money(p.skipped_total),
              })}
            </p>
          ) : null}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!ready || convert.isPending} onClick={submit}>
          {convert.isPending ? t("common.saving") : t("quotes.convert.submit")}
          <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </>
  );
}

export function ConvertQuoteDialog(props: {
  slug: string;
  quote: QuoteDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {props.open ? <ConvertQuoteDialogBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}
