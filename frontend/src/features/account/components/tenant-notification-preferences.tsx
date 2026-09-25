"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ErrorState } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  tenantNotificationPreferencesService,
  type NotificationChannelPrefs,
  type NotificationTypePreferences,
} from "@/features/account/services/tenant-notification-preferences.service";
import { typeKey } from "@/features/messaging/lib/render";
import { useLocale } from "@/providers/locale-provider";

const CHANNELS = ["inapp", "email", "whatsapp", "sms"] as const;
type Channel = (typeof CHANNELS)[number];

const queryKey = ["tenant", "notification-preferences"] as const;

export function TenantNotificationPreferences() {
  const { t } = useLocale();
  const query = useQuery({
    queryKey,
    queryFn: () => tenantNotificationPreferencesService.get(),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={t("messaging.prefs.error")}
        onRetry={() => void query.refetch()}
        retryLabel={t("messaging.templates.retry")}
      />
    );
  }
  return <PreferencesForm key={JSON.stringify(query.data)} data={query.data} />;
}

function PreferencesForm({ data }: { data: NotificationTypePreferences }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [phone, setPhone] = useState(data.phone);
  const [prefs, setPrefs] = useState<Record<string, NotificationChannelPrefs>>(
    () => Object.fromEntries(data.types.map((x) => [x.type, x.prefs])),
  );
  const save = useMutation({
    mutationFn: () =>
      tenantNotificationPreferencesService.update({
        phone: phone.trim(),
        types: data.types.map((x) => ({ type: x.type, prefs: prefs[x.type] })),
      }),
    onSuccess: (next) => {
      qc.setQueryData(queryKey, next);
      toast.success(t("messaging.prefs.saved"));
    },
  });
  const hasPhone = phone.trim() !== "";

  const toggle = (type: string, ch: Channel, value: boolean) =>
    setPrefs((p) => ({ ...p, [type]: { ...p[type], [ch]: value } }));

  const needsPhone = Object.values(prefs).some(
    (p) => (p.whatsapp || p.sms) && !hasPhone,
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!needsPhone) save.mutate();
      }}
    >
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="notif-phone">{t("messaging.prefs.phone")}</Label>
        <Input
          id="notif-phone"
          value={phone}
          inputMode="tel"
          maxLength={32}
          placeholder={t("messaging.prefs.phone_placeholder")}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          {t("messaging.prefs.phone_hint")}
        </p>
      </div>

      {data.types.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("messaging.prefs.empty")}
        </p>
      ) : (
        <div className="divide-y rounded-xl border">
          {data.types.map((type) => (
            <div
              key={type.type}
              className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between"
            >
              <p className="text-sm font-medium">
                {t(`messaging.types.${typeKey(type.type)}`)}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                {CHANNELS.filter((ch) =>
                  (type.channels as string[]).includes(ch),
                ).map((ch) => {
                  const id = `pref-${typeKey(type.type)}-${ch}`;
                  const phoneOnly = ch === "whatsapp" || ch === "sms";
                  return (
                    <div key={ch} className="flex items-center gap-2">
                      <Switch
                        id={id}
                        checked={prefs[type.type]?.[ch] ?? false}
                        disabled={phoneOnly && !hasPhone}
                        onCheckedChange={(v) => toggle(type.type, ch, v)}
                      />
                      <Label htmlFor={id} className="text-sm font-normal">
                        {t(`messaging.channel.${ch}`)}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {needsPhone
          ? t("messaging.prefs.phone_required")
          : t("messaging.prefs.default_hint")}
      </p>
      <Button type="submit" disabled={save.isPending || needsPhone}>
        {save.isPending
          ? t("messaging.prefs.saving")
          : t("messaging.prefs.save")}
      </Button>
    </form>
  );
}
