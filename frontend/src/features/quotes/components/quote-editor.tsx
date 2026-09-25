"use client";

import {
  ArrowLeft,
  Car,
  FileText,
  Package,
  PenLine,
  Send,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import {
  AsyncCombobox,
  type ComboboxOption,
} from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { routes } from "@/config/routes";
import {
  catalogService,
  type CatalogProduct,
  type CatalogService,
} from "@/features/catalog/services/catalog.service";
import { useCustomer } from "@/features/customers/hooks/use-customers";
import {
  catalogPickerOptions,
  customersService,
} from "@/features/customers/services/customers.service";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  CustomerPicker,
  type PickedCustomer,
} from "@/features/leads/components/customer-picker";
import { useLead } from "@/features/leads/hooks/use-leads";
import {
  useQuote,
  useQuoteMutations,
  useQuotesAccess,
} from "@/features/quotes/hooks/use-quotes";
import { computeDraftTotals } from "@/features/quotes/lib/quote-ui";
import type {
  DiscountType,
  QuoteDetail,
  SaveQuoteInput,
} from "@/features/quotes/types";
import { cn } from "@/lib/utils";
import { localToday, shiftDate } from "@/lib/utils/local-date";
import { useLocale } from "@/providers/locale-provider";

type LineType = "service" | "product" | "custom";

type EditorLine = {
  key: string;
  line_type: LineType;
  ref_uuid?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_type: DiscountType;
  discount_value: string;
  vat_rate: string;
};

type VehicleMode = "none" | "existing" | "free";

type EditorState = {
  customer: PickedCustomer | null;
  leadUuid: string | null;
  vehicleMode: VehicleMode;
  vehicleUuid: string;
  plate: string;
  label: string;
  catalog: string; // "modelUuid:year"
  catalogLabel: string;
  pricesIncludeVat: boolean;
  discountType: DiscountType;
  discountValue: string;
  validUntil: string;
  notes: string;
  terms: string;
  lines: EditorLine[];
};

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

function stateFromQuote(q: QuoteDetail): EditorState {
  const hasFree =
    !q.vehicle_uuid &&
    (q.vehicle_plate || q.vehicle_label || q.vehicle_model_uuid);
  return {
    customer: {
      uuid: q.customer_uuid,
      name: q.customer_name,
      phone: q.customer_phone,
    },
    leadUuid: q.lead_uuid ?? null,
    vehicleMode: q.vehicle_uuid ? "existing" : hasFree ? "free" : "none",
    vehicleUuid: q.vehicle_uuid ?? "",
    plate: q.vehicle_plate,
    label: q.vehicle_label,
    catalog:
      q.vehicle_model_uuid && q.vehicle_year
        ? `${q.vehicle_model_uuid}:${q.vehicle_year}`
        : "",
    catalogLabel: q.vehicle_model_label,
    pricesIncludeVat: q.prices_include_vat,
    discountType: q.discount_type,
    discountValue: q.discount_value === "0.00" ? "" : q.discount_value,
    validUntil: q.valid_until ?? "",
    notes: q.notes,
    terms: q.terms,
    lines: q.lines.map((l) => ({
      key: newKey(),
      line_type: l.line_type,
      ref_uuid: l.service_uuid ?? l.product_uuid ?? undefined,
      description: l.description,
      quantity: l.quantity.replace(/\.?0+$/, "") || "1",
      unit: l.unit,
      unit_price: l.unit_price,
      discount_type: l.discount_type,
      discount_value: l.discount_value === "0.00" ? "" : l.discount_value,
      vat_rate: l.vat_rate.replace(/\.00$/, ""),
    })),
  };
}

function emptyState(): EditorState {
  return {
    customer: null,
    leadUuid: null,
    vehicleMode: "none",
    vehicleUuid: "",
    plate: "",
    label: "",
    catalog: "",
    catalogLabel: "",
    pricesIncludeVat: true,
    discountType: "none",
    discountValue: "",
    validUntil: shiftDate(localToday(), 15),
    notes: "",
    terms: "",
    lines: [],
  };
}

/** Route entry for /quotes/new and /quotes/[uuid]/edit. */
export function QuoteEditorPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid?: string;
}) {
  const { t } = useLocale();
  const access = useQuotesAccess();
  const searchParams = useSearchParams();
  const existing = useQuote(uuid ?? "");
  const leadParam = searchParams.get("lead") ?? "";
  const customerParam = searchParams.get("customer") ?? "";
  const lead = useLead(uuid ? "" : leadParam);
  const prefillCustomer = useCustomer(uuid || leadParam ? "" : customerParam);

  if (!access.canWrite) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {t("quotes.forbidden")}
      </p>
    );
  }
  if (uuid) {
    if (existing.isLoading) return <EditorSkeleton />;
    if (!existing.data) return <EmptyState title={t("quotes.not_found")} />;
    if (!existing.data.can_edit) {
      return (
        <EmptyState
          title={t("quotes.editor.locked")}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={routes.tenant.quotes.detail(slug, uuid)}>
                {t("quotes.back_to_quote")}
              </Link>
            </Button>
          }
        />
      );
    }
    return (
      <QuoteEditor
        slug={slug}
        quote={existing.data}
        initial={stateFromQuote(existing.data)}
      />
    );
  }
  if (
    (leadParam && lead.isLoading) ||
    (customerParam && !leadParam && prefillCustomer.isLoading)
  ) {
    return <EditorSkeleton />;
  }
  const initial = emptyState();
  if (lead.data) {
    initial.customer = {
      uuid: lead.data.customer_uuid,
      name: lead.data.customer_name,
      phone: lead.data.customer_phone,
    };
    initial.leadUuid = lead.data.uuid;
    if (lead.data.vehicle_uuid) {
      initial.vehicleMode = "existing";
      initial.vehicleUuid = lead.data.vehicle_uuid;
    } else if (lead.data.vehicle_text) {
      initial.vehicleMode = "free";
      initial.label = lead.data.vehicle_text;
    }
    initial.notes = lead.data.interest;
  } else if (prefillCustomer.data) {
    initial.customer = {
      uuid: prefillCustomer.data.uuid,
      name: prefillCustomer.data.name,
      phone: prefillCustomer.data.phone,
    };
  }
  return (
    <QuoteEditor
      slug={slug}
      initial={initial}
      leadLabel={lead.data?.interest}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

function QuoteEditor({
  slug,
  quote,
  initial,
  leadLabel,
}: {
  slug: string;
  quote?: QuoteDetail;
  initial: EditorState;
  leadLabel?: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [s, setS] = useState<EditorState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { create, update } = useQuoteMutations();
  const customerQuery = useCustomer(s.customer?.uuid ?? "");
  const vehicles = customerQuery.data?.vehicles ?? [];
  const pending = create.isPending || update.isPending;

  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const totals = useMemo(
    () =>
      computeDraftTotals(
        s.lines.map((l) => ({
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount_type: l.discount_type,
          discount_value: l.discount_value,
          vat_rate: l.vat_rate,
        })),
        s.discountType,
        s.discountValue,
        s.pricesIncludeVat,
      ),
    [s.lines, s.discountType, s.discountValue, s.pricesIncludeVat],
  );

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    setS((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  const removeLine = (key: string) =>
    setS((prev) => ({
      ...prev,
      lines: prev.lines.filter((l) => l.key !== key),
    }));
  const addCustom = () =>
    setS((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          key: newKey(),
          line_type: "custom",
          description: "",
          quantity: "1",
          unit: "",
          unit_price: "",
          discount_type: "none",
          discount_value: "",
          vat_rate: "20",
        },
      ],
    }));

  // Catalog search (services + products) — one pick adds a line.
  const [catalogPick, setCatalogPick] = useState("");
  const [catalogCache, setCatalogCache] = useState<
    Record<string, { type: LineType; item: CatalogService | CatalogProduct }>
  >({});
  const loadCatalog = useCallback(
    async (query: string) => {
      const q = query.trim() || undefined;
      const [services, products] = await Promise.all([
        catalogService
          .listServices({
            limit: 15,
            offset: 0,
            q,
            is_active: "true",
            sort: "name",
          })
          .catch(() => ({ items: [] as CatalogService[] })),
        catalogService
          .listProducts({
            limit: 15,
            offset: 0,
            q,
            is_active: "true",
            sort: "name",
          })
          .catch(() => ({ items: [] as CatalogProduct[] })),
      ]);
      const cache: typeof catalogCache = {};
      const opts: ComboboxOption[] = [];
      for (const svc of services.items) {
        cache[`s:${svc.uuid}`] = { type: "service", item: svc };
        opts.push({
          value: `s:${svc.uuid}`,
          label: svc.name,
          description: `${t("quotes.line_type.service")} · ${formatFinanceAmount(svc.price, svc.currency, locale)}`,
        });
      }
      for (const p of products.items) {
        cache[`p:${p.uuid}`] = { type: "product", item: p };
        opts.push({
          value: `p:${p.uuid}`,
          label: p.name,
          description: `${t("quotes.line_type.product")} · ${formatFinanceAmount(p.sale_price, p.currency, locale)}`,
        });
      }
      setCatalogCache((prev) => ({ ...prev, ...cache }));
      return opts;
    },
    [t, locale],
  );
  const pickCatalog = (value: string) => {
    const entry = catalogCache[value];
    setCatalogPick("");
    if (!entry) return;
    setErrors((e) => ({ ...e, lines: "" }));
    const isSvc = entry.type === "service";
    const item = entry.item;
    setS((prev) => {
      const existing = prev.lines.find((l) => l.ref_uuid === item.uuid);
      if (existing) {
        // Same item again → bump quantity.
        const qty = (Number(existing.quantity.replace(",", ".")) || 0) + 1;
        return {
          ...prev,
          lines: prev.lines.map((l) =>
            l.key === existing.key ? { ...l, quantity: String(qty) } : l,
          ),
        };
      }
      return {
        ...prev,
        lines: [
          ...prev.lines,
          {
            key: newKey(),
            line_type: entry.type,
            ref_uuid: item.uuid,
            description: item.name,
            quantity: "1",
            unit: isSvc ? "" : (item as CatalogProduct).unit,
            unit_price: isSvc
              ? (item as CatalogService).price
              : (item as CatalogProduct).sale_price,
            discount_type: "none",
            discount_value: "",
            vat_rate: String(Number(item.vat_rate)),
          },
        ],
      };
    });
  };

  const loadVehicleCatalog = useCallback(async (query: string) => {
    const res = await customersService.searchCatalog(query.trim());
    return catalogPickerOptions(res.items ?? []);
  }, []);

  const buildBody = (): SaveQuoteInput | null => {
    const errs: Record<string, string> = {};
    if (!s.customer) errs.customer = t("quotes.validation.customer");
    if (s.lines.length === 0) errs.lines = t("quotes.validation.lines");
    s.lines.forEach((l) => {
      if (!l.description.trim())
        errs[`d:${l.key}`] = t("quotes.validation.description");
      if (!(Number(l.quantity.replace(",", ".")) > 0))
        errs[`q:${l.key}`] = t("quotes.validation.quantity");
      if (
        l.unit_price.trim() === "" ||
        Number.isNaN(Number(l.unit_price.replace(",", ".")))
      )
        errs[`p:${l.key}`] = t("quotes.validation.price");
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !s.customer) return null;
    let vehicle: SaveQuoteInput["vehicle"] = null;
    if (s.vehicleMode === "existing" && s.vehicleUuid)
      vehicle = { vehicle_uuid: s.vehicleUuid };
    if (s.vehicleMode === "free") {
      const [modelUuid, year] = s.catalog ? s.catalog.split(":") : [];
      vehicle = {
        plate: s.plate.trim(),
        label: s.label.trim(),
        model_uuid: modelUuid || null,
        year: year ? Number(year) : null,
      };
    }
    const norm = (v: string) => v.trim().replace(",", ".");
    return {
      customer_uuid: s.customer.uuid,
      lead_uuid: s.leadUuid,
      vehicle,
      currency: quote?.currency ?? "TRY",
      prices_include_vat: s.pricesIncludeVat,
      discount_type: s.discountType,
      discount_value: norm(s.discountValue) || "0",
      valid_until: s.validUntil,
      notes: s.notes,
      terms: s.terms,
      lines: s.lines.map((l) => ({
        line_type: l.line_type,
        service_uuid: l.line_type === "service" ? l.ref_uuid : null,
        product_uuid: l.line_type === "product" ? l.ref_uuid : null,
        description: l.description.trim(),
        quantity: norm(l.quantity),
        unit: l.unit.trim(),
        unit_price: norm(l.unit_price),
        discount_type: l.discount_type,
        discount_value: norm(l.discount_value) || "0",
        vat_rate: norm(l.vat_rate) || "0",
      })),
    };
  };

  const save = async (andSend: boolean) => {
    const body = buildBody();
    if (!body) return;
    try {
      const saved = quote
        ? await update.mutateAsync({ uuid: quote.uuid, body })
        : await create.mutateAsync(body);
      router.push(
        `${routes.tenant.quotes.detail(slug, saved.uuid)}${andSend ? "?send=1" : ""}`,
      );
    } catch {
      /* the API error handler shows a toast */
    }
  };

  const money = (v: string) => formatFinanceAmount(v, "TRY", locale);

  return (
    <div className="mx-auto w-full max-w-6xl pb-28 lg:pb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={
            quote
              ? routes.tenant.quotes.detail(slug, quote.uuid)
              : routes.tenant.quotes.root(slug)
          }
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          {quote ? quote.number : t("quotes.title")}
        </Link>
        <h1 className="font-display flex items-center gap-2 text-xl font-semibold">
          <FileText className="text-primary size-5" />
          {quote
            ? t("quotes.editor.edit_title", { number: quote.number })
            : t("quotes.editor.new_title")}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Customer + vehicle */}
          <section className="bg-card grid gap-4 rounded-2xl border p-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("quotes.fields.customer")}</Label>
              <CustomerPicker
                value={s.customer?.uuid ?? ""}
                initial={s.customer}
                invalid={Boolean(errors.customer)}
                onChange={(c) => {
                  setErrors((e) => ({ ...e, customer: "" }));
                  setS((prev) => ({
                    ...prev,
                    customer: c,
                    vehicleUuid: "",
                    vehicleMode:
                      prev.vehicleMode === "existing"
                        ? "none"
                        : prev.vehicleMode,
                    leadUuid:
                      c && prev.customer?.uuid === c.uuid
                        ? prev.leadUuid
                        : null,
                  }));
                }}
              />
              {errors.customer ? (
                <p className="text-destructive text-xs">{errors.customer}</p>
              ) : null}
              {s.leadUuid ? (
                <p className="text-muted-foreground text-xs">
                  {t("quotes.editor.from_lead")}
                  {leadLabel ? `: ${leadLabel}` : ""}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Car className="size-4" />
                {t("quotes.fields.vehicle")}
              </Label>
              <div className="bg-muted inline-flex rounded-lg p-0.5 text-xs">
                {(["none", "existing", "free"] as VehicleMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={mode === "existing" && vehicles.length === 0}
                    onClick={() => set("vehicleMode", mode)}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium disabled:opacity-40",
                      s.vehicleMode === mode
                        ? "bg-background shadow-xs"
                        : "text-muted-foreground",
                    )}
                  >
                    {t(`quotes.vehicle_mode.${mode}`)}
                  </button>
                ))}
              </div>
              {s.vehicleMode === "existing" ? (
                <Select
                  value={s.vehicleUuid}
                  onValueChange={(v) => set("vehicleUuid", v)}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("quotes.editor.pick_vehicle")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles.map((v) => (
                      <SelectItem key={v.uuid} value={v.uuid}>
                        {v.plate} · {v.brand_name} {v.model_name} {v.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {s.vehicleMode === "free" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={s.plate}
                    onChange={(e) => set("plate", e.target.value.toUpperCase())}
                    placeholder={t("quotes.editor.plate_optional")}
                    maxLength={16}
                  />
                  <Input
                    value={s.label}
                    onChange={(e) => set("label", e.target.value)}
                    placeholder={t("quotes.editor.vehicle_label")}
                    maxLength={200}
                  />
                  <div className="sm:col-span-2">
                    <AsyncCombobox
                      value={s.catalog}
                      onValueChange={(v) => set("catalog", v)}
                      loadOptions={loadVehicleCatalog}
                      initialOptions={
                        s.catalog && s.catalogLabel
                          ? [{ value: s.catalog, label: s.catalogLabel }]
                          : undefined
                      }
                      placeholder={t("quotes.editor.vehicle_catalog")}
                      searchPlaceholder={t(
                        "quotes.editor.vehicle_catalog_search",
                      )}
                      emptyText={t("quotes.editor.vehicle_catalog_empty")}
                      clearable
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* Lines */}
          <section className="bg-card rounded-2xl border">
            <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
              <h2 className="text-sm font-semibold sm:mr-auto">
                {t("quotes.lines")}
              </h2>
              <AsyncCombobox
                value={catalogPick}
                onValueChange={pickCatalog}
                loadOptions={loadCatalog}
                placeholder={t("quotes.editor.add_catalog")}
                searchPlaceholder={t("quotes.editor.catalog_search")}
                emptyText={t("quotes.editor.catalog_empty")}
                className="sm:w-72"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCustom}
              >
                <PenLine className="size-4" />
                {t("quotes.editor.add_custom")}
              </Button>
            </div>
            {s.lines.length === 0 ? (
              <div
                className={cn(
                  "p-6 text-center text-sm",
                  errors.lines ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {errors.lines || t("quotes.editor.no_lines")}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <table className="hidden w-full text-sm md:table">
                  <thead className="text-muted-foreground text-xs">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-medium">
                        {t("quotes.fields.description")}
                      </th>
                      <th className="w-16 px-1 py-2 text-right font-medium">
                        {t("quotes.fields.quantity")}
                      </th>
                      <th className="w-24 px-1 py-2 text-right font-medium">
                        {t("quotes.fields.unit_price")}
                      </th>
                      <th className="w-32 px-1 py-2 text-right font-medium">
                        {t("quotes.fields.discount")}
                      </th>
                      <th className="w-16 px-1 py-2 text-right font-medium">
                        {t("quotes.fields.vat")}
                      </th>
                      <th className="w-28 px-3 py-2 text-right font-medium">
                        {t("quotes.fields.total")}
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={l.key} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <LineIcon type={l.line_type} />
                            <Input
                              value={l.description}
                              onChange={(e) =>
                                updateLine(l.key, {
                                  description: e.target.value,
                                })
                              }
                              className="h-8"
                              aria-invalid={Boolean(errors[`d:${l.key}`])}
                              placeholder={t("quotes.fields.description")}
                              maxLength={300}
                            />
                          </div>
                        </td>
                        <td className="px-1 py-2">
                          <Input
                            value={l.quantity}
                            inputMode="decimal"
                            onChange={(e) =>
                              updateLine(l.key, { quantity: e.target.value })
                            }
                            className="h-8 text-right tabular-nums"
                            aria-invalid={Boolean(errors[`q:${l.key}`])}
                          />
                        </td>
                        <td className="px-1 py-2">
                          <Input
                            value={l.unit_price}
                            inputMode="decimal"
                            onChange={(e) =>
                              updateLine(l.key, { unit_price: e.target.value })
                            }
                            className="h-8 text-right tabular-nums"
                            aria-invalid={Boolean(errors[`p:${l.key}`])}
                          />
                        </td>
                        <td className="px-1 py-2">
                          <DiscountInput
                            type={l.discount_type}
                            value={l.discount_value}
                            onChange={(discount_type, discount_value) =>
                              updateLine(l.key, {
                                discount_type,
                                discount_value,
                              })
                            }
                          />
                        </td>
                        <td className="px-1 py-2">
                          <Input
                            value={l.vat_rate}
                            inputMode="decimal"
                            onChange={(e) =>
                              updateLine(l.key, { vat_rate: e.target.value })
                            }
                            className="h-8 text-right tabular-nums"
                            aria-label={t("quotes.fields.vat")}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {money(totals.lines[i]?.total ?? "0")}
                        </td>
                        <td className="pr-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => removeLine(l.key)}
                            aria-label={t("common.delete")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Mobile cards */}
                <ul className="divide-y md:hidden">
                  {s.lines.map((l, i) => (
                    <li key={l.key} className="space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <LineIcon type={l.line_type} />
                        <Input
                          value={l.description}
                          onChange={(e) =>
                            updateLine(l.key, { description: e.target.value })
                          }
                          aria-invalid={Boolean(errors[`d:${l.key}`])}
                          placeholder={t("quotes.fields.description")}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(l.key)}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <LabeledInput
                          label={t("quotes.fields.quantity")}
                          value={l.quantity}
                          invalid={Boolean(errors[`q:${l.key}`])}
                          onChange={(v) => updateLine(l.key, { quantity: v })}
                        />
                        <LabeledInput
                          label={t("quotes.fields.unit_price")}
                          value={l.unit_price}
                          invalid={Boolean(errors[`p:${l.key}`])}
                          onChange={(v) => updateLine(l.key, { unit_price: v })}
                        />
                        <LabeledInput
                          label={t("quotes.fields.vat")}
                          value={l.vat_rate}
                          onChange={(v) => updateLine(l.key, { vat_rate: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <DiscountInput
                          type={l.discount_type}
                          value={l.discount_value}
                          onChange={(discount_type, discount_value) =>
                            updateLine(l.key, { discount_type, discount_value })
                          }
                        />
                        <span className="font-semibold tabular-nums">
                          {money(totals.lines[i]?.total ?? "0")}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="bg-card grid gap-4 rounded-2xl border p-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quote-notes">{t("quotes.fields.notes")}</Label>
              <Textarea
                id="quote-notes"
                rows={3}
                value={s.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-terms">{t("quotes.fields.terms")}</Label>
              <Textarea
                id="quote-terms"
                rows={3}
                value={s.terms}
                onChange={(e) => set("terms", e.target.value)}
                placeholder={t("quotes.editor.terms_placeholder")}
              />
            </div>
          </section>
        </div>

        {/* Totals sidebar */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="bg-card space-y-4 rounded-2xl border p-4">
            <div className="space-y-1.5">
              <Label>{t("quotes.fields.valid_until")}</Label>
              <DatePicker
                value={s.validUntil}
                onChange={(v) => set("validUntil", v)}
              />
              <div className="flex flex-wrap gap-1">
                {[7, 15, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="text-muted-foreground hover:text-foreground rounded border px-1.5 py-0.5 text-[11px]"
                    onClick={() =>
                      set("validUntil", shiftDate(localToday(), d))
                    }
                  >
                    {t("quotes.editor.days", { days: d })}
                  </button>
                ))}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground rounded border px-1.5 py-0.5 text-[11px]"
                  onClick={() => set("validUntil", "")}
                >
                  {t("quotes.editor.no_expiry")}
                </button>
              </div>
            </div>
            <label className="flex items-center justify-between gap-2 text-sm">
              {t("quotes.fields.prices_include_vat")}
              <Switch
                checked={s.pricesIncludeVat}
                onCheckedChange={(v) => set("pricesIncludeVat", v)}
              />
            </label>
            <div className="space-y-1.5">
              <Label>{t("quotes.fields.quote_discount")}</Label>
              <DiscountInput
                type={s.discountType}
                value={s.discountValue}
                onChange={(type, value) =>
                  setS((prev) => ({
                    ...prev,
                    discountType: type,
                    discountValue: value,
                  }))
                }
                wide
              />
            </div>
            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <Row
                label={t("quotes.fields.subtotal")}
                value={money(totals.subtotal)}
              />
              {totals.discount !== "0.00" ? (
                <Row
                  label={t("quotes.fields.discount_total")}
                  value={`-${money(totals.discount)}`}
                />
              ) : null}
              <Row
                label={
                  s.pricesIncludeVat
                    ? t("quotes.fields.vat_included")
                    : t("quotes.fields.vat_total")
                }
                value={money(totals.vat)}
              />
              <div className="flex items-baseline justify-between border-t pt-2">
                <dt className="font-medium">
                  {t("quotes.fields.grand_total")}
                </dt>
                <dd className="text-primary text-xl font-semibold tabular-nums">
                  {money(totals.grand)}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-[11px]">
              {t("quotes.editor.server_totals")}
            </p>
            <div className="hidden flex-col gap-2 lg:flex">
              <Button disabled={pending} onClick={() => void save(true)}>
                <Send className="size-4" />
                {t("quotes.actions.save_send")}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void save(false)}
              >
                {pending
                  ? t("common.saving")
                  : quote
                    ? t("common.save")
                    : t("quotes.actions.save_draft")}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile bottom bar */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t p-3 backdrop-blur lg:hidden">
        <div className="mr-auto min-w-0">
          <p className="text-muted-foreground text-[11px]">
            {t("quotes.fields.grand_total")}
          </p>
          <p className="text-primary truncate text-lg font-semibold tabular-nums">
            {money(totals.grand)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void save(false)}
        >
          {quote ? t("common.save") : t("quotes.actions.save_draft")}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => void save(true)}>
          <Send className="size-4" />
          {t("quotes.actions.send_short")}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function LineIcon({ type }: { type: LineType }) {
  const { t } = useLocale();
  const Icon =
    type === "service" ? Wrench : type === "product" ? Package : PenLine;
  return (
    <span
      title={t(`quotes.line_type.${type}`)}
      className="text-muted-foreground shrink-0"
    >
      <Icon className="size-4" />
    </span>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <Input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className="h-9 text-right tabular-nums"
        aria-invalid={invalid}
      />
    </label>
  );
}

function DiscountInput({
  type,
  value,
  onChange,
  wide,
}: {
  type: DiscountType;
  value: string;
  onChange: (type: DiscountType, value: string) => void;
  wide?: boolean;
}) {
  const { t } = useLocale();
  const cycle: DiscountType[] = ["none", "percent", "amount"];
  const symbol = type === "percent" ? "%" : type === "amount" ? "₺" : "—";
  return (
    <div className={cn("flex items-center gap-1", wide ? "w-full" : "w-32")}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-9 shrink-0 px-0 font-mono"
        title={t(`quotes.discount_type.${type}`)}
        onClick={() => {
          const next = cycle[(cycle.indexOf(type) + 1) % cycle.length]!;
          onChange(next, next === "none" ? "" : value);
        }}
      >
        {symbol}
      </Button>
      <Input
        value={type === "none" ? "" : value}
        disabled={type === "none"}
        inputMode="decimal"
        placeholder={type === "none" ? t("quotes.discount_type.none") : "0"}
        onChange={(e) => onChange(type, e.target.value)}
        className="h-8 text-right tabular-nums"
        aria-label={t("quotes.fields.discount")}
      />
    </div>
  );
}
