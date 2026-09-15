"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CONTRACT_VARIABLES } from "@/features/contract-presets/services/contract-presets.service";
import { useLocale } from "@/providers/locale-provider";

export function VariablesChips({
  selected,
  onToggle,
  onInsert,
}: {
  selected: string[];
  onToggle: (key: string) => void;
  onInsert?: (token: string) => void;
}) {
  const { t } = useLocale();

  return (
    <div className="space-y-2">
      <Label>{t("contracts.fields.variables")}</Label>
      <p className="text-muted-foreground text-xs">
        {t("contracts.variables.hint")}
      </p>
      <div className="flex flex-wrap gap-2">
        {CONTRACT_VARIABLES.map((key) => {
          const active = selected.includes(key);
          return (
            <Badge
              key={key}
              variant={active ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => {
                onToggle(key);
                onInsert?.(`{{${key}}}`);
              }}
            >
              {t(`contracts.variables.${key}`)}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
