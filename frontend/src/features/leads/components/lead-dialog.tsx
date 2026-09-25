"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { useCustomer } from "@/features/customers/hooks/use-customers";
import {
  CustomerPicker,
  type PickedCustomer,
} from "@/features/leads/components/customer-picker";
import { TemperatureToggle } from "@/features/leads/components/temperature-toggle";
import {
  useLeadAssignees,
  useLeadMutations,
} from "@/features/leads/hooks/use-leads";
import {
  LEAD_SOURCES,
  type LeadDetail,
  type LeadSource,
  type LeadTemperature,
} from "@/features/leads/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const NONE = "__none__";

type FormState = {
  customer: PickedCustomer | null;
  interest: string;
  vehicleUuid: string;
  vehicleText: string;
  source: LeadSource;
  temperature: LeadTemperature;
  followUp: string;
  assignee: string;
  notes: string;
};

function initialState(
  lead?: LeadDetail | null,
  defaults?: Partial<FormState>,
): FormState {
  if (lead) {
    return {
      customer: {
        uuid: lead.customer_uuid,
        name: lead.customer_name,
        phone: lead.customer_phone,
      },
      interest: lead.interest,
      vehicleUuid: lead.vehicle_uuid ?? "",
      vehicleText: lead.vehicle_text,
      source: lead.source,
      temperature: lead.temperature,
      followUp: lead.follow_up_date ?? "",
      assignee: lead.assignee?.uuid ?? "",
      notes: lead.notes,
    };
  }
  return {
    customer: null,
    interest: "",
    vehicleUuid: "",
    vehicleText: "",
    source: "incoming_call",
    temperature: "warm",
    followUp: "",
    assignee: "",
    notes: "",
    ...defaults,
  };
}

/** Create or edit a lead. Few required fields: customer only. */
type LeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: LeadDetail | null;
  defaults?: Partial<FormState>;
  onSaved?: (lead: LeadDetail) => void;
};

export function LeadDialog(props: LeadDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {props.open ? <LeadDialogBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LeadDialogBody({
  onOpenChange,
  lead,
  defaults,
  onSaved,
}: LeadDialogProps) {
  const { t } = useLocale();
  const [form, setForm] = useState<FormState>(() =>
    initialState(lead, defaults),
  );
  const [customerError, setCustomerError] = useState(false);
  const { create, patch } = useLeadMutations();
  const assignees = useLeadAssignees(true);
  const customerQuery = useCustomer(form.customer?.uuid ?? "");
  const vehicles = customerQuery.data?.vehicles ?? [];

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const pending = create.isPending || patch.isPending;

  const submit = async () => {
    if (!form.customer) {
      setCustomerError(true);
      return;
    }
    try {
      if (lead) {
        const saved = await patch.mutateAsync({
          uuid: lead.uuid,
          body: {
            customer_uuid: form.customer.uuid,
            interest: form.interest,
            vehicle_uuid: form.vehicleUuid,
            vehicle_text: form.vehicleText,
            source: form.source,
            temperature: form.temperature,
            follow_up_date: form.followUp,
            assignee_uuid: form.assignee,
            notes: form.notes,
          },
        });
        onSaved?.(saved);
      } else {
        const saved = await create.mutateAsync({
          customer_uuid: form.customer.uuid,
          interest: form.interest.trim(),
          vehicle_uuid: form.vehicleUuid || null,
          vehicle_text: form.vehicleText.trim(),
          source: form.source,
          temperature: form.temperature,
          follow_up_date: form.followUp || null,
          assignee_uuid: form.assignee || null,
          notes: form.notes.trim(),
        });
        onSaved?.(saved);
      }
      onOpenChange(false);
    } catch {
      /* toast via global handler */
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {lead ? t("leads.dialog.edit_title") : t("leads.dialog.create_title")}
        </DialogTitle>
        <DialogDescription>{t("leads.dialog.description")}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label>{t("leads.fields.source")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_SOURCES.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => set("source", src)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  form.source === src
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`leads.source.${src}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("leads.fields.customer")}</Label>
          <CustomerPicker
            value={form.customer?.uuid ?? ""}
            initial={form.customer}
            invalid={customerError}
            onChange={(c) => {
              setCustomerError(false);
              setForm((prev) => ({ ...prev, customer: c, vehicleUuid: "" }));
            }}
          />
          {customerError ? (
            <p className="text-destructive text-xs">
              {t("leads.validation.customer")}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lead-interest">{t("leads.fields.interest")}</Label>
          <Input
            id="lead-interest"
            value={form.interest}
            maxLength={300}
            placeholder={t("leads.placeholders.interest")}
            onChange={(e) => set("interest", e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("leads.fields.vehicle")}</Label>
            {vehicles.length > 0 ? (
              <Select
                value={form.vehicleUuid || NONE}
                onValueChange={(v) => set("vehicleUuid", v === NONE ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("leads.placeholders.no_vehicle")}
                  </SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v.uuid} value={v.uuid}>
                      {v.plate} · {v.brand_name} {v.model_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={form.vehicleText}
                maxLength={200}
                placeholder={t("leads.placeholders.vehicle_text")}
                onChange={(e) => set("vehicleText", e.target.value)}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t("leads.fields.temperature")}</Label>
            <div>
              <TemperatureToggle
                value={form.temperature}
                onChange={(v) => set("temperature", v)}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("leads.fields.follow_up_date")}</Label>
            <DatePicker
              value={form.followUp}
              onChange={(v) => set("followUp", v)}
              placeholder={t("leads.placeholders.follow_up")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("leads.fields.assignee")}</Label>
            <Select
              value={form.assignee || NONE}
              onValueChange={(v) => set("assignee", v === NONE ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("leads.unassigned")}</SelectItem>
                {(assignees.data ?? []).map((a) => (
                  <SelectItem key={a.uuid} value={a.uuid}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lead-notes">{t("leads.fields.notes")}</Label>
          <Textarea
            id="lead-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>

        <DialogFooter>
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
      </form>
    </>
  );
}
