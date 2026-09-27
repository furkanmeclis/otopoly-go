"use client";

import { addMonths, addYears, format, parseISO } from "date-fns";
import { useState } from "react";

import {
  AsyncCombobox,
  type ComboboxOption,
} from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
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
import type {
  AdminSubscription,
  SubscriptionPeriod,
} from "@/features/billing/types";
import { organizationsService } from "@/features/organizations/services/organizations.service";
import {
  usePlatformPlans,
  usePlatformSubscriptionMutations,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { useLocale } from "@/providers/locale-provider";

export const loadOrganizations = async (
  query: string,
): Promise<ComboboxOption[]> => {
  const res = await organizationsService.list({
    q: query || undefined,
    limit: 20,
    offset: 0,
  });
  return res.items.map((o) => ({
    value: o.uuid,
    label: o.name,
    description: o.slug,
  }));
};

const today = () => format(new Date(), "yyyy-MM-dd");
const periodEnd = (start: string, period: SubscriptionPeriod) => {
  const d = parseISO(start);
  return format(
    period === "yearly" ? addYears(d, 1) : addMonths(d, 1),
    "yyyy-MM-dd",
  );
};
/** Day values are stored as yyyy-MM-dd; the API takes an Istanbul-midnight timestamp. */
const toApiTime = (day: string) => `${day}T00:00:00+03:00`;

export function SubscriptionDialog({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: AdminSubscription | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open ? (
          <Body onOpenChange={onOpenChange} subscription={subscription} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  onOpenChange,
  subscription,
}: {
  onOpenChange: (open: boolean) => void;
  subscription: AdminSubscription | null;
}) {
  const { t } = useLocale();
  const plans = usePlatformPlans(true);
  const { create, update } = usePlatformSubscriptionMutations();
  const editing = subscription !== null;
  const [orgUuid, setOrgUuid] = useState("");
  const [planUuid, setPlanUuid] = useState(subscription?.plan.uuid ?? "");
  const [period, setPeriod] = useState<SubscriptionPeriod>(
    subscription?.period ?? "monthly",
  );
  const [startsAt, setStartsAt] = useState(
    subscription ? subscription.starts_at.slice(0, 10) : today(),
  );
  const [endsAt, setEndsAt] = useState(
    subscription
      ? subscription.ends_at.slice(0, 10)
      : periodEnd(today(), "monthly"),
  );
  const [price, setPrice] = useState("0");
  const [note, setNote] = useState(subscription?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setError(null);
    if ((!editing && !orgUuid) || !planUuid || !endsAt) {
      return setError(t("billing.validation.required"));
    }
    try {
      if (editing) {
        await update.mutateAsync({
          uuid: subscription.uuid,
          body: {
            ends_at: toApiTime(endsAt),
            plan_uuid: planUuid,
            note: note.trim(),
          },
        });
      } else {
        await create.mutateAsync({
          organization_uuid: orgUuid,
          plan_uuid: planUuid,
          period,
          starts_at: toApiTime(startsAt),
          ends_at: toApiTime(endsAt),
          price_paid: String(Number(price) || 0),
          note: note.trim(),
        });
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
          {editing ? t("billing.subs.edit") : t("billing.subs.new")}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.subs.organization")}</Label>
          {editing ? (
            <p className="text-sm font-medium">
              {subscription.organization.name}
            </p>
          ) : (
            <AsyncCombobox
              value={orgUuid}
              onValueChange={setOrgUuid}
              loadOptions={loadOrganizations}
              placeholder={t("billing.subs.organization")}
              searchPlaceholder={t("billing.subs.organization_search")}
            />
          )}
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.subs.plan")}</Label>
          <Select value={planUuid} onValueChange={setPlanUuid}>
            <SelectTrigger>
              <SelectValue placeholder={t("billing.subs.plan")} />
            </SelectTrigger>
            <SelectContent>
              {(plans.data ?? []).map((p) => (
                <SelectItem key={p.uuid} value={p.uuid}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.subs.period")}</Label>
          <Select
            value={period}
            disabled={editing}
            onValueChange={(v) => {
              const next = v as SubscriptionPeriod;
              setPeriod(next);
              setEndsAt(periodEnd(startsAt, next));
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">
                {t("billing.period.monthly")}
              </SelectItem>
              <SelectItem value="yearly">
                {t("billing.period.yearly")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.subs.starts_at")}</Label>
          <DatePicker
            value={startsAt}
            disabled={editing}
            onChange={(v) => {
              setStartsAt(v);
              if (v) setEndsAt(periodEnd(v, period));
            }}
          />
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.subs.ends_at")}</Label>
          <DatePicker value={endsAt} onChange={setEndsAt} />
        </div>
        {!editing ? (
          <div>
            <Label className="mb-1 block">{t("billing.subs.price_paid")}</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.subs.note")}</Label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error ? (
          <p className="text-destructive text-sm sm:col-span-2">{error}</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t("billing.admin.plan.cancel")}
        </Button>
        <Button onClick={submit} disabled={pending}>
          {t("billing.admin.plan.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
