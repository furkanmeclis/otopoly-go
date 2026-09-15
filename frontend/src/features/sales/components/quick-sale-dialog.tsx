"use client";

import { useCallback, useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Trash2 } from "lucide-react";
import { z } from "zod";

import { AppForm, AppSelect, AppTextarea } from "@/components/forms";
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
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppLocale } from "@/config/i18n";
import { catalogService } from "@/features/catalog/services/catalog.service";
import { customersService } from "@/features/customers/services/customers.service";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { useSalesMutations } from "@/features/sales/hooks/use-sales";
import type {
  CreateSaleInput,
  SaleDetail,
  SaleMethod,
} from "@/features/sales/services/sales.service";
import { useLocale } from "@/providers/locale-provider";

const SALE_METHODS = ["cash", "card", "cari"] as const;

type SaleLineDraft = {
  key: string;
  product_uuid: string;
  name: string;
  unit_price: string;
  qty: string;
  currency: string;
};

type QuickSaleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (sale: SaleDetail) => void;
};

export function QuickSaleDialog({
  open,
  onOpenChange,
  onSuccess,
}: QuickSaleDialogProps) {
  const { t, locale } = useLocale();
  const mutations = useSalesMutations();
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const accounts = accountsQuery.data?.items ?? [];
  const defaultAccountUuid =
    accounts.find((account) => account.is_default)?.uuid ??
    accounts[0]?.uuid ??
    "";

  const [customerUuid, setCustomerUuid] = useState("");
  const [productPicker, setProductPicker] = useState("");
  const [lines, setLines] = useState<SaleLineDraft[]>([]);
  const [lineError, setLineError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setCustomerUuid("");
    setProductPicker("");
    setLines([]);
    setLineError(null);
  }, []);

  const schema = useMemo(
    () =>
      z
        .object({
          method: z.enum(SALE_METHODS),
          finance_account_uuid: z.string().optional(),
          notes: z.string().optional(),
        })
        .superRefine((values, ctx) => {
          if (
            (values.method === "cash" || values.method === "card") &&
            !values.finance_account_uuid
          ) {
            ctx.addIssue({
              code: "custom",
              path: ["finance_account_uuid"],
              message: t("sales.validation.finance_account"),
            });
          }
        }),
    [t],
  );

  const loadCustomers = useCallback(async (query: string) => {
    const result = await customersService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
    });
    return result.items.map((customer) => ({
      value: customer.uuid,
      label: customer.phone
        ? `${customer.name} · ${customer.phone}`
        : customer.name,
    }));
  }, []);

  const loadProducts = useCallback(async (query: string) => {
    const result = await catalogService.listProducts({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
      sort: "name",
    });
    return result.items.map((product) => ({
      value: product.uuid,
      label: product.sku ? `${product.name} · ${product.sku}` : product.name,
      description: `${product.sale_price} ${product.currency}`,
    }));
  }, []);

  const addProduct = useCallback(
    async (productUuid: string) => {
      if (!productUuid) return;
      setLineError(null);
      if (lines.some((line) => line.product_uuid === productUuid)) {
        setProductPicker("");
        return;
      }
      try {
        const product = await catalogService.getProduct(productUuid);
        setLines((prev) => [
          ...prev,
          {
            key: `${product.uuid}-${Date.now()}`,
            product_uuid: product.uuid,
            name: product.name,
            unit_price: product.sale_price,
            qty: "1",
            currency: product.currency,
          },
        ]);
      } catch {
        /* list already showed product; ignore fetch failure */
      }
      setProductPicker("");
    },
    [lines],
  );

  const liveTotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const price = parseFinanceAmount(line.unit_price);
        const qty = parseFinanceAmount(line.qty);
        return sum + price * qty;
      }, 0),
    [lines],
  );

  const currency = lines[0]?.currency ?? "TRY";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sales.quick.title")}</DialogTitle>
          <DialogDescription>{t("sales.quick.description")}</DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? `sale-${defaultAccountUuid}` : "sale-closed"}
          schema={schema}
          defaultValues={{
            method: "cash" as SaleMethod,
            finance_account_uuid: defaultAccountUuid,
            notes: "",
          }}
          onSubmit={async (values) => {
            if (lines.length === 0) {
              setLineError(t("sales.validation.lines"));
              return;
            }
            if (values.method === "cari" && !customerUuid) {
              setLineError(t("sales.validation.cari_customer"));
              return;
            }
            const body: CreateSaleInput = {
              customer_uuid: customerUuid || null,
              notes: values.notes?.trim() || undefined,
              method: values.method,
              finance_account_uuid:
                values.method === "cari"
                  ? undefined
                  : values.finance_account_uuid || undefined,
              lines: lines.map((line) => ({
                product_uuid: line.product_uuid,
                unit_price: line.unit_price || undefined,
                qty: line.qty || undefined,
              })),
            };
            const created = await mutations.create.mutateAsync(body);
            reset();
            onOpenChange(false);
            onSuccess?.(created);
          }}
        >
          <QuickSaleFields
            customerUuid={customerUuid}
            onCustomerChange={setCustomerUuid}
            loadCustomers={loadCustomers}
            productPicker={productPicker}
            onProductPickerChange={setProductPicker}
            loadProducts={loadProducts}
            onAddProduct={(uuid) => void addProduct(uuid)}
            lines={lines}
            onUpdateLine={(key, patch) => {
              setLines((prev) =>
                prev.map((line) =>
                  line.key === key ? { ...line, ...patch } : line,
                ),
              );
            }}
            onRemoveLine={(key) => {
              setLines((prev) => prev.filter((line) => line.key !== key));
            }}
            lineError={lineError}
            liveTotal={liveTotal}
            currency={currency}
            locale={locale}
            accounts={accounts}
            pending={mutations.create.isPending}
            onCancel={() => onOpenChange(false)}
          />
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function QuickSaleFields({
  customerUuid,
  onCustomerChange,
  loadCustomers,
  productPicker,
  onProductPickerChange,
  loadProducts,
  onAddProduct,
  lines,
  onUpdateLine,
  onRemoveLine,
  lineError,
  liveTotal,
  currency,
  locale,
  accounts,
  pending,
  onCancel,
}: {
  customerUuid: string;
  onCustomerChange: (uuid: string) => void;
  loadCustomers: (query: string) => Promise<{ value: string; label: string }[]>;
  productPicker: string;
  onProductPickerChange: (value: string) => void;
  loadProducts: (
    query: string,
  ) => Promise<{ value: string; label: string; description?: string }[]>;
  onAddProduct: (uuid: string) => void;
  lines: SaleLineDraft[];
  onUpdateLine: (
    key: string,
    patch: Partial<Pick<SaleLineDraft, "qty" | "unit_price">>,
  ) => void;
  onRemoveLine: (key: string) => void;
  lineError: string | null;
  liveTotal: number;
  currency: string;
  locale: AppLocale;
  accounts: { uuid: string; name: string; currency: string }[];
  pending?: boolean;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const form = useFormContext<{
    method: SaleMethod;
    finance_account_uuid?: string;
    notes?: string;
  }>();
  const method = form.watch("method");
  const cariBlocked = method === "cari" && !customerUuid;

  return (
    <>
      <FieldGroup className="gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("sales.customer")}</Label>
          <AsyncCombobox
            value={customerUuid}
            onValueChange={onCustomerChange}
            loadOptions={loadCustomers}
            placeholder={t("sales.pick_customer")}
            searchPlaceholder={t("sales.search_customer")}
            emptyText={t("sales.no_customers")}
            clearable
          />
          {cariBlocked ? (
            <p className="text-destructive text-sm">
              {t("sales.validation.cari_customer")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("sales.products")}</Label>
          <AsyncCombobox
            value={productPicker}
            onValueChange={(value) => {
              onProductPickerChange(value);
              if (value) onAddProduct(value);
            }}
            loadOptions={loadProducts}
            placeholder={t("sales.pick_product")}
            searchPlaceholder={t("sales.search_product")}
            emptyText={t("sales.no_products")}
            hideSelected
            selectedValues={lines.map((line) => line.product_uuid)}
          />
          {lines.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("sales.quick.lines_hint")}
            </p>
          ) : (
            <ul className="divide-border divide-y rounded-md border">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{line.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={line.qty}
                      onChange={(event) =>
                        onUpdateLine(line.key, { qty: event.target.value })
                      }
                      className="h-8 w-20 tabular-nums"
                      aria-label={t("sales.qty")}
                      inputMode="decimal"
                    />
                    <Input
                      value={line.unit_price}
                      onChange={(event) =>
                        onUpdateLine(line.key, {
                          unit_price: event.target.value,
                        })
                      }
                      className="h-8 w-28 tabular-nums"
                      aria-label={t("sales.unit_price")}
                      inputMode="decimal"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={() => onRemoveLine(line.key)}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {lineError ? (
            <p className="text-destructive text-sm">{lineError}</p>
          ) : null}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-muted-foreground text-sm">
              {t("sales.total")}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatFinanceAmount(liveTotal, currency, locale)}
            </span>
          </div>
        </div>

        <AppSelect
          name="method"
          label={t("sales.method")}
          options={SALE_METHODS.map((value) => ({
            value,
            label: t(`sales.payment_method.${value}`),
          }))}
        />
        {method !== "cari" ? (
          <AppSelect
            name="finance_account_uuid"
            label={t("sales.finance_account")}
            placeholder={t("sales.pick_finance_account")}
            options={accounts.map((account) => ({
              value: account.uuid,
              label: `${account.name} (${account.currency})`,
            }))}
          />
        ) : null}
        <AppTextarea name="notes" label={t("sales.notes")} />
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || cariBlocked}>
          {pending ? t("common.saving") : t("sales.quick.submit")}
        </Button>
      </DialogFooter>
    </>
  );
}
