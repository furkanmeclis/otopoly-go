"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { meterLabel } from "@/features/billing/lib";
import type {
  BillingEnforcement,
  BillingFeature,
  BillingPlanFeatureValue,
} from "@/features/billing/types";
import { useLocale } from "@/providers/locale-provider";

type Props = {
  features: BillingFeature[];
  values: BillingPlanFeatureValue[];
  onChange: (values: BillingPlanFeatureValue[]) => void;
  disabled?: boolean;
};

export function emptyValue(key: string): BillingPlanFeatureValue {
  return {
    key,
    value_int: null,
    value_bool: null,
    display_text: "",
    enforcement: "hard",
    tolerance_pct: 0,
    warn_pct: 80,
    min_value: null,
    max_value: null,
    step: null,
    unit_price: null,
  };
}

/**
 * One row per catalog feature. Limit rows can be left undefined (= unlimited);
 * a defined row is sent with its numbers, toggles with a bool, display rows
 * with their text.
 */
export function PlanFeaturesEditor({
  features,
  values,
  onChange,
  disabled,
}: Props) {
  const { t, locale } = useLocale();
  const byKey = new Map(values.map((v) => [v.key, v]));

  const setValue = (
    key: string,
    patch: Partial<BillingPlanFeatureValue> | null,
  ) => {
    const next = values.filter((v) => v.key !== key);
    if (patch !== null)
      next.push({ ...(byKey.get(key) ?? emptyValue(key)), ...patch });
    onChange(next);
  };

  return (
    <div className="divide-y rounded-md border">
      {features
        .filter((f) => f.is_active)
        .map((f) => {
          const v = byKey.get(f.key);
          const defined = Boolean(v);
          return (
            <div
              key={f.key}
              className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {meterLabel(f, locale)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {f.key} · {t(`billing.admin.feature.kind.${f.kind}`)}
                  {f.unit ? ` · ${f.unit}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {f.kind === "toggle" ? (
                  <Switch
                    disabled={disabled}
                    checked={v?.value_bool === true}
                    onCheckedChange={(checked) =>
                      setValue(f.key, { value_bool: checked, value_int: null })
                    }
                    aria-label={meterLabel(f, locale)}
                  />
                ) : f.kind === "display" ? (
                  <Input
                    disabled={disabled}
                    className="w-56"
                    placeholder={t("billing.admin.plan.feature.display_text")}
                    value={v?.display_text ?? ""}
                    onChange={(e) =>
                      setValue(
                        f.key,
                        e.target.value
                          ? { display_text: e.target.value }
                          : null,
                      )
                    }
                  />
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        disabled={disabled}
                        checked={defined}
                        onCheckedChange={(checked) =>
                          setValue(f.key, checked ? { value_int: 0 } : null)
                        }
                      />
                      {defined
                        ? t("billing.admin.plan.feature.defined")
                        : t("billing.admin.plan.feature.undefined")}
                    </label>
                    {defined ? (
                      <>
                        <Input
                          type="number"
                          min={0}
                          disabled={disabled}
                          className="w-24"
                          aria-label={t("billing.admin.plan.feature.value")}
                          value={v?.value_int ?? 0}
                          onChange={(e) =>
                            setValue(f.key, {
                              value_int: Math.max(
                                0,
                                Number(e.target.value) || 0,
                              ),
                            })
                          }
                        />
                        <Select
                          disabled={disabled}
                          value={v?.enforcement ?? "hard"}
                          onValueChange={(val) =>
                            setValue(f.key, {
                              enforcement: val as BillingEnforcement,
                            })
                          }
                        >
                          <SelectTrigger
                            className="w-28"
                            aria-label={t(
                              "billing.admin.plan.feature.enforcement",
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hard">
                              {t("billing.admin.plan.feature.hard")}
                            </SelectItem>
                            <SelectItem value="soft">
                              {t("billing.admin.plan.feature.soft")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <PctInput
                          label={t("billing.admin.plan.feature.tolerance")}
                          value={v?.tolerance_pct ?? 0}
                          disabled={disabled}
                          onChange={(n) =>
                            setValue(f.key, { tolerance_pct: n })
                          }
                        />
                        <PctInput
                          label={t("billing.admin.plan.feature.warn")}
                          value={v?.warn_pct ?? 80}
                          disabled={disabled}
                          onChange={(n) => setValue(f.key, { warn_pct: n })}
                        />
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}

function PctInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <label className="text-muted-foreground flex items-center gap-1 text-xs">
      {label}
      <Input
        type="number"
        min={0}
        max={100}
        disabled={disabled}
        className="w-16"
        value={value}
        onChange={(e) =>
          onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
        }
      />
    </label>
  );
}
