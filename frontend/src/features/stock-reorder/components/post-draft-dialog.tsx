"use client";

import { useMemo, useState } from "react";

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
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import type {
  PurchaseDetail,
  PurchaseMethod,
} from "@/features/purchases/services/purchases.service";
import { useStockReorderMutations } from "@/features/stock-reorder/hooks/use-stock-reorder";
import { useLocale } from "@/providers/locale-provider";

type LineDraft = {
  product_uuid: string;
  name: string;
  qty: string;
  unit_cost: string;
};

/** "Onayla ve alışa çevir": pick payment method + account, adjust quantities / costs, post the draft. */
export function PostDraftDialog({
  draft,
  onOpenChange,
  onPosted,
}: {
  draft: PurchaseDetail | null;
  onOpenChange: (open: boolean) => void;
  onPosted?: (posted: PurchaseDetail) => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {draft ? (
          <PostDraftBody
            key={draft.uuid}
            draft={draft}
            onOpenChange={onOpenChange}
            onPosted={onPosted}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PostDraftBody({
  draft,
  onOpenChange,
  onPosted,
}: {
  draft: PurchaseDetail;
  onOpenChange: (open: boolean) => void;
  onPosted?: (posted: PurchaseDetail) => void;
}) {
  const { t, locale } = useLocale();
  const { postDraft } = useStockReorderMutations();
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const accounts = useMemo(
    () =>
      (accountsQuery.data?.items ?? []).filter(
        (a) => a.currency === draft.currency,
      ),
    [accountsQuery.data, draft],
  );
  const [method, setMethod] = useState<PurchaseMethod>("cash");
  const [picked, setPicked] = useState("");
  const account =
    picked || (accounts.find((a) => a.is_default) ?? accounts[0])?.uuid || "";
  const [lines, setLines] = useState<LineDraft[]>(() =>
    draft.lines.map((l) => ({
      product_uuid: l.product_uuid,
      name: l.name,
      qty: l.qty,
      unit_cost: l.unit_cost,
    })),
  );
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce(
    (sum, l) =>
      sum + parseFinanceAmount(l.qty) * parseFinanceAmount(l.unit_cost),
    0,
  );

  const submit = async () => {
    if (!draft) return;
    if (!account) {
      setError(t("purchases.validation.finance_account"));
      return;
    }
    if (lines.some((l) => !(parseFinanceAmount(l.qty) > 0))) {
      setError(t("stock_reorder.validation.qty"));
      return;
    }
    if (total <= 0) {
      setError(t("stock_reorder.validation.total"));
      return;
    }
    const posted = await postDraft.mutateAsync({
      uuid: draft.uuid,
      body: {
        method,
        finance_account_uuid: account,
        lines: lines.map((l) => ({
          product_uuid: l.product_uuid,
          qty: l.qty.replace(",", "."),
          unit_cost: l.unit_cost.replace(",", "."),
        })),
      },
    });
    onOpenChange(false);
    onPosted?.(posted);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("stock_reorder.post.title")}</DialogTitle>
        <DialogDescription>
          {draft
            ? t("stock_reorder.post.description", {
                supplier: draft.supplier_name,
              })
            : null}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <ul className="divide-y rounded-md border">
          {lines.map((line, index) => (
            <li
              key={line.product_uuid}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {line.name}
              </span>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-20 tabular-nums"
                  inputMode="decimal"
                  value={line.qty}
                  aria-label={t("purchases.qty")}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === index ? { ...l, qty: e.target.value } : l,
                      ),
                    )
                  }
                />
                <Input
                  className="h-8 w-28 tabular-nums"
                  inputMode="decimal"
                  value={line.unit_cost}
                  aria-label={t("purchases.unit_cost")}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === index ? { ...l, unit_cost: e.target.value } : l,
                      ),
                    )
                  }
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("purchases.total")}</span>
          <span className="font-semibold tabular-nums">
            {formatFinanceAmount(total, draft?.currency ?? "TRY", locale)}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("purchases.method")}</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PurchaseMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">
                  {t("purchases.payment_method.cash")}
                </SelectItem>
                <SelectItem value="card">
                  {t("purchases.payment_method.card")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("purchases.finance_account")}</Label>
            <Select value={account} onValueChange={setPicked}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t("purchases.pick_finance_account")}
                />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.uuid} value={a.uuid}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("stock_reorder.post.hint")}
        </p>
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
        <Button
          type="button"
          disabled={postDraft.isPending}
          onClick={() => void submit()}
        >
          {postDraft.isPending
            ? t("common.saving")
            : t("stock_reorder.actions.post")}
        </Button>
      </DialogFooter>
    </>
  );
}
