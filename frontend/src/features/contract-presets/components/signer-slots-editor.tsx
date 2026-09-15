"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SignerSlot } from "@/features/contract-presets/services/contract-presets.service";
import { useLocale } from "@/providers/locale-provider";

const PRESET_ROLES = [
  { role: "customer", labelKey: "contracts.signer_roles.customer" },
  { role: "staff", labelKey: "contracts.signer_roles.staff" },
  { role: "custom", labelKey: "contracts.signer_roles.custom" },
] as const;

function roleSelectValue(role: string): string {
  if (role === "customer" || role === "staff") return role;
  return "custom";
}

export function SignerSlotsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: SignerSlot[];
  onChange: (slots: SignerSlot[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label>{t("contracts.fields.signer_slots")}</Label>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("contracts.fields.signer_slots_hint")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...value,
              {
                role: "customer",
                label: t("contracts.signer_roles.customer"),
                required: true,
              },
            ])
          }
        >
          <Plus className="size-4" />
          {t("contracts.fields.add_slot")}
        </Button>
      </div>
      <ul className="space-y-2">
        {value.map((slot, index) => {
          const selectValue = roleSelectValue(slot.role);
          return (
            <li
              key={`${index}-${slot.role}-${slot.label}`}
              className="border-border flex flex-wrap items-end gap-2 rounded-md border p-3"
            >
              <div className="min-w-[10rem] flex-1 space-y-1">
                <Label className="text-xs">
                  {t("contracts.fields.signer_type")}
                </Label>
                <Select
                  value={selectValue}
                  disabled={disabled}
                  onValueChange={(next) => {
                    const copy = [...value];
                    if (next === "customer") {
                      copy[index] = {
                        ...slot,
                        role: "customer",
                        label: t("contracts.signer_roles.customer"),
                      };
                    } else if (next === "staff") {
                      copy[index] = {
                        ...slot,
                        role: "staff",
                        label: t("contracts.signer_roles.staff"),
                      };
                    } else {
                      copy[index] = {
                        ...slot,
                        role: slot.role === "customer" || slot.role === "staff"
                          ? "other"
                          : slot.role || "other",
                        label:
                          slot.label || t("contracts.signer_roles.custom"),
                      };
                    }
                    onChange(copy);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_ROLES.map((item) => (
                      <SelectItem key={item.role} value={item.role}>
                        {t(item.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectValue === "custom" ? (
                <div className="min-w-[10rem] flex-1 space-y-1">
                  <Label className="text-xs">
                    {t("contracts.fields.label")}
                  </Label>
                  <Input
                    value={slot.label}
                    disabled={disabled}
                    placeholder={t("contracts.fields.label_placeholder")}
                    onChange={(e) => {
                      const next = [...value];
                      next[index] = {
                        ...slot,
                        label: e.target.value,
                        role: e.target.value
                          .trim()
                          .toLowerCase()
                          .replace(/\s+/g, "_") || "other",
                      };
                      onChange(next);
                    }}
                  />
                </div>
              ) : null}
              <label className="mb-2 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={slot.required}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    const next = [...value];
                    next[index] = { ...slot, required: checked === true };
                    onChange(next);
                  }}
                />
                {t("contracts.fields.required")}
              </label>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled || value.length <= 1}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={t("contracts.fields.remove_slot")}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
