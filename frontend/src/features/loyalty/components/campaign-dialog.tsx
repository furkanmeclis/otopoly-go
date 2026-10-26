"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import {
  AppDatePicker,
  AppForm,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea,
} from "@/components/forms";
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
import {
  EligibilityPicker,
  useServiceOptions,
} from "@/features/loyalty/components/eligibility-picker";
import { useLoyaltyMutations } from "@/features/loyalty/hooks/use-loyalty";
import type {
  CampaignInput,
  LoyaltyCampaign,
  RewardType,
} from "@/features/loyalty/services/loyalty.service";
import { useLocale } from "@/providers/locale-provider";

const REWARD_TYPES: RewardType[] = ["free_service", "percent", "fixed"];

export function CampaignDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign?: LoyaltyCampaign | null;
}) {
  const { t } = useLocale();
  const { createCampaign, updateCampaign } = useLoyaltyMutations();

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(1, t("form.required")),
          description: z.string().optional(),
          service_uuids: z.array(z.string()),
          category_uuids: z.array(z.string()),
          stamps_required: z.coerce.number().int().min(1).max(100),
          reward_type: z.enum(["free_service", "percent", "fixed"]),
          reward_service_uuid: z.string().optional(),
          reward_value: z.string().optional(),
          valid_from: z.string().optional(),
          valid_until: z.string().optional(),
          per_customer_limit: z.string().optional(),
          is_active: z.boolean(),
        })
        .superRefine((v, ctx) => {
          if (!v.service_uuids.length && !v.category_uuids.length) {
            ctx.addIssue({
              code: "custom",
              path: ["service_uuids"],
              message: t("loyalty.validation.eligibility"),
            });
          }
          if (v.reward_type === "free_service" && !v.reward_service_uuid) {
            ctx.addIssue({
              code: "custom",
              path: ["reward_service_uuid"],
              message: t("form.required"),
            });
          }
          if (v.reward_type !== "free_service") {
            const n = Number((v.reward_value ?? "").replace(",", "."));
            if (!(n > 0) || (v.reward_type === "percent" && n > 100)) {
              ctx.addIssue({
                code: "custom",
                path: ["reward_value"],
                message: t("loyalty.validation.reward_value"),
              });
            }
          }
          if (v.valid_from && v.valid_until && v.valid_until < v.valid_from) {
            ctx.addIssue({
              code: "custom",
              path: ["valid_until"],
              message: t("loyalty.validation.window"),
            });
          }
        }),
    [t],
  );
  type Values = z.infer<typeof schema>;

  const defaults: Values = campaign
    ? {
        name: campaign.name,
        description: campaign.description,
        service_uuids: campaign.services.map((s) => s.uuid),
        category_uuids: campaign.categories.map((c) => c.uuid),
        stamps_required: campaign.stamps_required,
        reward_type: campaign.reward_type,
        reward_service_uuid: campaign.reward_service?.uuid ?? "",
        reward_value:
          campaign.reward_type === "free_service" ? "" : campaign.reward_value,
        valid_from: campaign.valid_from ?? "",
        valid_until: campaign.valid_until ?? "",
        per_customer_limit: campaign.per_customer_limit
          ? String(campaign.per_customer_limit)
          : "",
        is_active: campaign.is_active,
      }
    : {
        name: "",
        description: "",
        service_uuids: [],
        category_uuids: [],
        stamps_required: 10,
        reward_type: "free_service",
        reward_service_uuid: "",
        reward_value: "",
        valid_from: "",
        valid_until: "",
        per_customer_limit: "",
        is_active: true,
      };

  async function onSubmit(v: Values) {
    const body: CampaignInput = {
      name: v.name.trim(),
      description: v.description?.trim() ?? "",
      service_uuids: v.service_uuids,
      category_uuids: v.category_uuids,
      stamps_required: v.stamps_required,
      reward_type: v.reward_type,
      reward_service_uuid:
        v.reward_type === "free_service" ? v.reward_service_uuid || null : null,
      reward_value:
        v.reward_type === "free_service"
          ? ""
          : (v.reward_value ?? "").replace(",", "."),
      valid_from: v.valid_from || null,
      valid_until: v.valid_until || null,
      per_customer_limit: v.per_customer_limit
        ? Number(v.per_customer_limit)
        : null,
      is_active: v.is_active,
    };
    if (campaign) {
      await updateCampaign.mutateAsync({ uuid: campaign.uuid, body });
    } else {
      await createCampaign.mutateAsync(body);
    }
    onOpenChange(false);
  }

  const pending = createCampaign.isPending || updateCampaign.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {campaign
              ? t("loyalty.campaigns.edit")
              : t("loyalty.campaigns.new")}
          </DialogTitle>
          <DialogDescription>
            {t("loyalty.campaigns.form_hint")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={campaign?.uuid ?? (open ? "campaign-new" : "campaign-closed")}
          schema={schema}
          defaultValues={defaults}
          onSubmit={onSubmit}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="name"
              label={t("loyalty.fields.name")}
              placeholder={t("loyalty.campaigns.name_placeholder")}
              required
            />
            <EligibilityPicker />
            <RewardFields />
            <div className="grid gap-4 sm:grid-cols-3">
              <AppDatePicker
                name="valid_from"
                label={t("loyalty.fields.valid_from")}
              />
              <AppDatePicker
                name="valid_until"
                label={t("loyalty.fields.valid_until")}
              />
              <AppInput
                name="per_customer_limit"
                type="number"
                label={t("loyalty.fields.per_customer_limit")}
                placeholder={t("loyalty.fields.unlimited")}
              />
            </div>
            <AppSwitch name="is_active" label={t("loyalty.fields.is_active")} />
            <AppTextarea
              name="description"
              label={t("loyalty.fields.description")}
              rows={2}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function RewardFields() {
  const { t } = useLocale();
  const form = useFormContext<{ reward_type: RewardType }>();
  const type = form.watch("reward_type");
  const services = useServiceOptions();
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <AppInput
        name="stamps_required"
        type="number"
        label={t("loyalty.fields.stamps_required")}
        description={t("loyalty.fields.stamps_required_hint")}
      />
      <AppSelect
        name="reward_type"
        label={t("loyalty.fields.reward_type")}
        options={REWARD_TYPES.map((value) => ({
          value,
          label: t(`loyalty.reward_type.${value}`),
        }))}
      />
      {type === "free_service" ? (
        <AppSelect
          name="reward_service_uuid"
          label={t("loyalty.fields.reward_service")}
          placeholder={t("loyalty.fields.pick_service")}
          options={services.map((s) => ({ value: s.value, label: s.label }))}
        />
      ) : (
        <AppInput
          name="reward_value"
          type="number"
          step="any"
          label={
            type === "percent"
              ? t("loyalty.fields.reward_percent")
              : t("loyalty.fields.reward_amount")
          }
        />
      )}
    </div>
  );
}
