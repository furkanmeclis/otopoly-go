"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { z } from "zod";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { DaySummaryBar } from "@/components/common/day-summary-bar";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import { EntityActions, EntityPage, EntityToolbar } from "@/components/entity";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";
import { catalogService } from "@/features/catalog/services/catalog.service";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { ResourceIOToolbar } from "@/features/io";
import {
  usePurchases,
  usePurchasesMeta,
  usePurchasesMutations,
} from "@/features/purchases/hooks/use-purchases";
import { useTenantPurchasesAccess } from "@/features/purchases/hooks/use-tenant-purchases-access";
import type {
  CreatePurchaseInput,
  Purchase,
  PurchaseMethod,
  PurchaseStatus,
} from "@/features/purchases/services/purchases.service";
import { suppliersService } from "@/features/suppliers/services/suppliers.service";
import { datetime } from "@/lib/utils/format";
import { localToday } from "@/lib/utils/local-date";
import { useLocale } from "@/providers/locale-provider";

const STATUS_TABS = ["all", "posted", "voided"] as const;
const PURCHASE_METHODS = ["cash", "card"] as const;

function statusTone(status: PurchaseStatus) {
  switch (status) {
    case "posted":
      return "success" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

type PurchaseLineDraft = {
  key: string;
  product_uuid: string;
  name: string;
  unit_cost: string;
  qty: string;
  currency: string;
};

export function PurchasesPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantPurchasesAccess(slug);
  const mutations = usePurchasesMutations();

  const [date, setDate] = useState(() => localToday());
  const [statusTab, setStatusTab] =
    useState<(typeof STATUS_TABS)[number]>("all");
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const listParams = useMemo(
    () => ({
      limit: 100,
      offset: 0,
      sort: "-purchased_at",
      q: q.trim() || undefined,
      status: statusTab === "all" ? undefined : statusTab,
      date_from: date || undefined,
      date_to: date || undefined,
    }),
    [date, q, statusTab],
  );

  const listQuery = usePurchases(listParams);
  const metaQuery = usePurchasesMeta();

  const applySearch = useCallback(() => {
    setQ(searchInput.trim());
  }, [searchInput]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("purchases.forbidden")}
      />
    );
  }

  const items = listQuery.data?.items ?? [];
  // No summary endpoint for purchases: totals from the day's posted rows.
  const posted = items.filter((p) => p.status === "posted");
  const dayCurrency = items[0]?.currency ?? "TRY";
  const sumBy = (method?: string) =>
    posted
      .filter((p) => !method || p.method === method)
      .reduce((total, p) => total + parseFinanceAmount(p.total_amount), 0);
  const money = (value: number) =>
    formatFinanceAmount(value, dayCurrency, locale);

  return (
    <EntityPage
      title={t("purchases.title")}
      description={t("purchases.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("purchases.title") },
      ]}
      actions={
        canWrite ? (
          <EntityActions>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t("purchases.actions.create")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      <DaySummaryBar
        date={date}
        onDateChange={setDate}
        loading={listQuery.isLoading}
        stats={[
          { label: t("purchases.summary.count"), value: String(posted.length) },
          {
            label: t("purchases.summary.total"),
            value: money(sumBy()),
            accent: true,
          },
          {
            label: t("purchases.payment_method.cash"),
            value: money(sumBy("cash")),
          },
          {
            label: t("purchases.payment_method.card"),
            value: money(sumBy("card")),
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applySearch();
            }}
            placeholder={t("purchases.search_placeholder")}
            className="pl-9"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={applySearch}>
          {t("common.search")}
        </Button>
        <ResourceIOToolbar
          resource="tenant.purchases"
          query={{
            q: listParams.q,
            status: listParams.status,
            date_from: listParams.date_from,
            date_to: listParams.date_to,
            sort: listParams.sort,
          }}
          capabilities={metaQuery.data?.capabilities}
          jobsHref={routes.tenant.exports.root(slug)}
          scope="tenant"
        />
        <EntityToolbar
          onRefresh={() => void listQuery.refetch()}
          refreshDisabled={listQuery.isFetching}
        />
      </div>

      <Tabs
        value={statusTab}
        onValueChange={(value) =>
          setStatusTab(value as (typeof STATUS_TABS)[number])
        }
        className="mb-4"
      >
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`purchases.filter.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {listQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {listQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("purchases.error_description")}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && items.length === 0 ? (
        <EmptyState
          title={t("purchases.empty_title")}
          description={t("purchases.empty_hint")}
          action={
            canWrite ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                {t("purchases.actions.create")}
              </Button>
            ) : null
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((purchase) => (
          <PurchaseCard
            key={purchase.uuid}
            purchase={purchase}
            onOpen={() =>
              router.push(routes.tenant.purchases.detail(slug, purchase.uuid))
            }
          />
        ))}
      </div>

      <CreatePurchaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={mutations.create.isPending}
        onSubmit={async (body) => {
          const created = await mutations.create.mutateAsync(body);
          setCreateOpen(false);
          router.push(routes.tenant.purchases.detail(slug, created.uuid));
        }}
      />
    </EntityPage>
  );
}

function PurchaseCard({
  purchase,
  onOpen,
}: {
  purchase: Purchase;
  onOpen: () => void;
}) {
  const { t, locale } = useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-visible:ring-ring rounded-xl text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <Card className="hover:border-primary/40 hover:bg-muted/20 h-full shadow-none transition-colors">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base font-semibold">
              {purchase.supplier_name}
            </CardTitle>
            <p className="text-muted-foreground truncate text-sm">
              {t(`purchases.payment_method.${purchase.method}`)}
            </p>
          </div>
          <StatusChip
            label={t(`purchases.status.${purchase.status}`)}
            tone={statusTone(purchase.status)}
          />
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {datetime(purchase.purchased_at, "dd.MM.yyyy HH:mm", locale)}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatFinanceAmount(
                purchase.total_amount,
                purchase.currency,
                locale,
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function CreatePurchaseDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onSubmit: (body: CreatePurchaseInput) => Promise<void>;
}) {
  const { t, locale } = useLocale();
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

  const [supplierUuid, setSupplierUuid] = useState("");
  const [productPicker, setProductPicker] = useState("");
  const [lines, setLines] = useState<PurchaseLineDraft[]>([]);
  const [lineError, setLineError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSupplierUuid("");
    setProductPicker("");
    setLines([]);
    setLineError(null);
  }, []);

  const schema = useMemo(
    () =>
      z.object({
        method: z.enum(PURCHASE_METHODS),
        finance_account_uuid: z
          .string()
          .min(1, t("purchases.validation.finance_account")),
        notes: z.string().optional(),
      }),
    [t],
  );

  const loadSuppliers = useCallback(async (query: string) => {
    const result = await suppliersService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
    });
    return result.items.map((supplier) => ({
      value: supplier.uuid,
      label: supplier.phone
        ? `${supplier.name} · ${supplier.phone}`
        : supplier.name,
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
      description: formatFinanceAmount(
        product.cost_price,
        product.currency,
        locale,
      ),
    }));
  }, [locale]);

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
            unit_cost: product.cost_price,
            qty: "1",
            currency: product.currency,
          },
        ]);
      } catch {
        /* ignore */
      }
      setProductPicker("");
    },
    [lines],
  );

  const liveTotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const cost = parseFinanceAmount(line.unit_cost);
        const qty = parseFinanceAmount(line.qty);
        return sum + cost * qty;
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
          <DialogTitle>{t("purchases.actions.create")}</DialogTitle>
          <DialogDescription>
            {t("purchases.create.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? `purchase-${defaultAccountUuid}` : "purchase-closed"}
          schema={schema}
          defaultValues={{
            method: "cash" as PurchaseMethod,
            finance_account_uuid: defaultAccountUuid,
            notes: "",
          }}
          onSubmit={async (values) => {
            if (!supplierUuid) {
              setLineError(t("purchases.validation.supplier"));
              return;
            }
            if (lines.length === 0) {
              setLineError(t("purchases.validation.lines"));
              return;
            }
            await onSubmit({
              supplier_uuid: supplierUuid,
              notes: values.notes?.trim() || undefined,
              method: values.method,
              finance_account_uuid: values.finance_account_uuid,
              lines: lines.map((line) => ({
                product_uuid: line.product_uuid,
                unit_cost: line.unit_cost || undefined,
                qty: line.qty || undefined,
              })),
            });
            reset();
          }}
        >
          <CreatePurchaseFields
            supplierUuid={supplierUuid}
            onSupplierChange={setSupplierUuid}
            loadSuppliers={loadSuppliers}
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
            pending={pending}
            onCancel={() => onOpenChange(false)}
          />
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function CreatePurchaseFields({
  supplierUuid,
  onSupplierChange,
  loadSuppliers,
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
  supplierUuid: string;
  onSupplierChange: (uuid: string) => void;
  loadSuppliers: (query: string) => Promise<{ value: string; label: string }[]>;
  productPicker: string;
  onProductPickerChange: (value: string) => void;
  loadProducts: (
    query: string,
  ) => Promise<{ value: string; label: string; description?: string }[]>;
  onAddProduct: (uuid: string) => void;
  lines: PurchaseLineDraft[];
  onUpdateLine: (
    key: string,
    patch: Partial<Pick<PurchaseLineDraft, "qty" | "unit_cost">>,
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

  return (
    <>
      <FieldGroup className="gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {t("purchases.supplier")}
          </Label>
          <AsyncCombobox
            value={supplierUuid}
            onValueChange={onSupplierChange}
            loadOptions={loadSuppliers}
            placeholder={t("purchases.pick_supplier")}
            searchPlaceholder={t("purchases.search_supplier")}
            emptyText={t("purchases.no_suppliers")}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {t("purchases.products")}
          </Label>
          <AsyncCombobox
            value={productPicker}
            onValueChange={(value) => {
              onProductPickerChange(value);
              if (value) onAddProduct(value);
            }}
            loadOptions={loadProducts}
            placeholder={t("purchases.pick_product")}
            searchPlaceholder={t("purchases.search_product")}
            emptyText={t("purchases.no_products")}
            hideSelected
            selectedValues={lines.map((line) => line.product_uuid)}
          />
          {lines.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("purchases.create.lines_hint")}
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
                      aria-label={t("purchases.qty")}
                      inputMode="decimal"
                    />
                    <Input
                      value={line.unit_cost}
                      onChange={(event) =>
                        onUpdateLine(line.key, {
                          unit_cost: event.target.value,
                        })
                      }
                      className="h-8 w-28 tabular-nums"
                      aria-label={t("purchases.unit_cost")}
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
              {t("purchases.total")}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatFinanceAmount(liveTotal, currency, locale)}
            </span>
          </div>
        </div>

        <AppSelect
          name="method"
          label={t("purchases.method")}
          options={PURCHASE_METHODS.map((value) => ({
            value,
            label: t(`purchases.payment_method.${value}`),
          }))}
        />
        <AppSelect
          name="finance_account_uuid"
          label={t("purchases.finance_account")}
          placeholder={t("purchases.pick_finance_account")}
          options={accounts.map((account) => ({
            value: account.uuid,
            label: `${account.name} (${account.currency})`,
          }))}
        />
        <AppTextarea name="notes" label={t("purchases.notes")} />
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
