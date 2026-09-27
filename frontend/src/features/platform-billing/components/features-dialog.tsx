"use client";

import { useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { meterLabel } from "@/features/billing/lib";
import {
  usePlatformFeatureMutations,
  usePlatformFeatures,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { useLocale } from "@/providers/locale-provider";

const KEY_RE = /^[a-z0-9_.-]{2,64}$/;

export function FeaturesDialog({
  open,
  onOpenChange,
  canWrite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
}) {
  const { t, locale } = useLocale();
  const features = usePlatformFeatures(open);
  const { create, setActive } = usePlatformFeatureMutations();
  const [form, setForm] = useState({ key: "", label_tr: "", label_en: "", sort_order: 200 });
  const [error, setError] = useState("");

  const submit = async () => {
    if (!KEY_RE.test(form.key)) {
      setError(t("billing.validation.code"));
      return;
    }
    if (!form.label_tr.trim() || !form.label_en.trim()) {
      setError(t("billing.validation.required"));
      return;
    }
    setError("");
    try {
      await create.mutateAsync({ ...form, label_tr: form.label_tr.trim(), label_en: form.label_en.trim() });
      setForm({ key: "", label_tr: "", label_en: "", sort_order: form.sort_order + 10 });
    } catch {
      /* toast via global handler */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("billing.admin.features")}</DialogTitle>
          <DialogDescription>{t("billing.admin.feature.description")}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border text-sm">
          {(features.data ?? []).map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 p-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{meterLabel(f, locale)}</p>
                <p className="text-muted-foreground text-xs">
                  {f.key} · {t(`billing.admin.feature.kind.${f.kind}`)}
                  {f.is_builtin ? ` · ${t("billing.admin.feature.builtin")}` : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                {t("billing.admin.feature.active")}
                <Switch
                  checked={f.is_active}
                  disabled={f.is_builtin || !canWrite || setActive.isPending}
                  onCheckedChange={(v) => setActive.mutate({ id: f.id, isActive: v })}
                />
              </label>
            </li>
          ))}
        </ul>
        {canWrite ? (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{t("billing.admin.feature.new")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1 block">{t("billing.admin.feature.key")}</Label>
                <Input
                  placeholder={t("billing.admin.feature.key_hint")}
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.trim() })}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t("billing.admin.feature.sort_order")}</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label className="mb-1 block">{t("billing.admin.feature.label_tr")}</Label>
                <Input value={form.label_tr} onChange={(e) => setForm({ ...form, label_tr: e.target.value })} />
              </div>
              <div>
                <Label className="mb-1 block">{t("billing.admin.feature.label_en")}</Label>
                <Input value={form.label_en} onChange={(e) => setForm({ ...form, label_en: e.target.value })} />
              </div>
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
            <DialogFooter>
              <Button onClick={submit} disabled={create.isPending}>
                {t("billing.admin.plan.save")}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
