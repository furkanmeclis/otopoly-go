"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, BellRing, Car, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { routes } from "@/config/routes";
import {
  useSaveVehicleAlerts,
  useSendTestVehicleAlert,
  useVehicleAlertSettings,
} from "@/features/messaging/hooks/use-vehicle-alerts";
import {
  VEHICLE_ALERT_BATCH_OPTIONS,
  VEHICLE_ALERT_EVENTS,
  type VehicleAlertSettings,
} from "@/features/messaging/services/vehicle-alerts.service";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const sameSet = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

/**
 * Team vehicle alerts: in-app/push instantly to the selected members; a
 * WhatsApp message (instant or batched) to those web push cannot reach.
 */
export function VehicleAlertsCard() {
  const { t } = useLocale();
  const query = useVehicleAlertSettings();
  const data = query.data;

  if (!data) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="size-4" />
            {t("messaging.vehicle_alerts.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p
            className={
              query.isError
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {query.isError
              ? t("messaging.vehicle_alerts.errors.generic")
              : t("common.loading")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Re-mount the form when the saved settings change.
  const savedKey = [
    data.enabled,
    data.batch_minutes,
    [...data.events].sort().join(","),
    [...data.service_uuids].sort().join(","),
    [...data.recipient_user_uuids].sort().join(","),
  ].join("|");
  return <VehicleAlertsForm key={savedKey} data={data} />;
}

function VehicleAlertsForm({ data }: { data: VehicleAlertSettings }) {
  const { t } = useLocale();
  const params = useParams<{ slug: string }>();
  const slug = String(params.slug ?? "");
  const save = useSaveVehicleAlerts();
  const sendTest = useSendTestVehicleAlert();

  const [enabled, setEnabled] = useState(data.enabled);
  const [events, setEvents] = useState<string[]>(data.events);
  const [allServices, setAllServices] = useState(
    data.service_uuids.length === 0,
  );
  const [services, setServices] = useState<string[]>(data.service_uuids);
  const [recipients, setRecipients] = useState<string[]>(
    data.recipient_user_uuids,
  );
  const [batch, setBatch] = useState<number>(data.batch_minutes);

  const effectiveServices = allServices ? [] : services;
  const dirty =
    data.enabled !== enabled ||
    data.batch_minutes !== batch ||
    !sameSet(data.events, events) ||
    !sameSet(data.service_uuids, effectiveServices) ||
    !sameSet(data.recipient_user_uuids, recipients);

  const toggle =
    (setter: (fn: (prev: string[]) => string[]) => void, id: string) =>
    (checked: boolean | "indeterminate") =>
      setter((prev) =>
        checked ? [...prev, id] : prev.filter((x) => x !== id),
      );

  const errorMessage = (err: unknown) => {
    if (isApiError(err)) {
      const key = `messaging.vehicle_alerts.errors.${err.code}`;
      const translated = t(key);
      return translated !== key ? translated : err.message;
    }
    return t("messaging.vehicle_alerts.errors.generic");
  };

  async function onSave() {
    try {
      await save.mutateAsync({
        enabled,
        events: events as VehicleAlertSettings["events"],
        service_uuids: effectiveServices,
        recipient_user_uuids: recipients,
        batch_minutes: batch,
      });
      toast.success(t("messaging.vehicle_alerts.saved"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onSendTest() {
    try {
      const res = await sendTest.mutateAsync();
      toast.success(
        t("messaging.vehicle_alerts.test_sent", {
          in_app: res.in_app,
          whatsapp: res.whatsapp,
        }),
      );
      if (res.skipped.length > 0) {
        toast.warning(
          t("messaging.vehicle_alerts.test_skipped", {
            names: res.skipped.join(", "),
          }),
        );
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const selectedNeedingPhone = data.members.filter(
    (m) => recipients.includes(m.uuid) && !m.has_push && !m.has_phone,
  );

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Car className="size-4" />
          {t("messaging.vehicle_alerts.title")}
        </CardTitle>
        <CardDescription>
          {t("messaging.vehicle_alerts.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!data.whatsapp_connected ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t("messaging.vehicle_alerts.not_connected")}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Label htmlFor="vehicle-alerts-enabled">
            {t("messaging.vehicle_alerts.enabled")}
          </Label>
          <Switch
            id="vehicle-alerts-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">
              {t("messaging.vehicle_alerts.events")}
            </legend>
            {VEHICLE_ALERT_EVENTS.map((ev) => (
              <label
                key={ev}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={events.includes(ev)}
                  onCheckedChange={toggle(setEvents, ev)}
                />
                {t(`messaging.vehicle_alerts.event.${ev}`)}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">
              {t("messaging.vehicle_alerts.frequency")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {VEHICLE_ALERT_BATCH_OPTIONS.map((opt) => (
                <Button
                  key={opt}
                  type="button"
                  size="sm"
                  variant={batch === opt ? "default" : "outline"}
                  onClick={() => setBatch(opt)}
                >
                  {t(`messaging.vehicle_alerts.batch.${opt}`)}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("messaging.vehicle_alerts.frequency_hint")}
            </p>
          </fieldset>
        </div>

        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">
            {t("messaging.vehicle_alerts.services")}
          </legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={allServices}
              onCheckedChange={(v) => setAllServices(v === true)}
            />
            {t("messaging.vehicle_alerts.all_services")}
          </label>
          {!allServices ? (
            <div className="grid gap-1.5 pt-1 sm:grid-cols-2 lg:grid-cols-3">
              {data.services.map((sv) => (
                <label
                  key={sv.uuid}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={services.includes(sv.uuid)}
                    onCheckedChange={toggle(setServices, sv.uuid)}
                  />
                  <span className="truncate">{sv.name}</span>
                </label>
              ))}
              {data.services.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("messaging.vehicle_alerts.no_services")}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <div className="space-y-2">
          <div>
            <Label>{t("messaging.vehicle_alerts.recipients")}</Label>
            <p className="text-muted-foreground text-xs">
              {t("messaging.vehicle_alerts.recipients_hint")}
            </p>
          </div>
          <ul className="divide-y rounded-lg border">
            {data.members.map((m) => (
              <li key={m.uuid}>
                <label className="hover:bg-muted/40 flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={recipients.includes(m.uuid)}
                    onCheckedChange={toggle(setRecipients, m.uuid)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {m.name || m.email}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {m.email}
                    </span>
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {m.role === "owner"
                      ? t("messaging.vehicle_alerts.role_owner")
                      : t("messaging.vehicle_alerts.role_staff")}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 gap-1",
                      !m.has_push &&
                        !m.has_phone &&
                        "border-amber-500/40 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {m.has_push ? <BellRing className="size-3" /> : null}
                    {m.has_push
                      ? t("messaging.vehicle_alerts.via_push")
                      : m.has_phone
                        ? t("messaging.vehicle_alerts.via_whatsapp")
                        : t("messaging.vehicle_alerts.via_inapp_only")}
                  </Badge>
                </label>
              </li>
            ))}
          </ul>
          {selectedNeedingPhone.length > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t("messaging.vehicle_alerts.no_channel_hint", {
                names: selectedNeedingPhone
                  .map((m) => m.name || m.email)
                  .join(", "),
              })}{" "}
              <Link
                href={routes.tenant.profile.root(slug)}
                className="underline"
              >
                {t("messaging.vehicle_alerts.no_channel_link")}
              </Link>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              sendTest.isPending ||
              dirty ||
              data.recipient_user_uuids.length === 0
            }
            title={dirty ? t("messaging.vehicle_alerts.save_first") : undefined}
            onClick={() => void onSendTest()}
          >
            <Send className="size-4" />
            {t("messaging.vehicle_alerts.send_test")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => void onSave()}
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
