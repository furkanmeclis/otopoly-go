"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { StatusChip } from "@/components/common/status-chip";
import { EntityDrawer } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { priorityTone, statusTone } from "@/features/notifications/constants";
import { notificationActions } from "@/features/notifications/lib/notification-action";
import { formatNotificationText } from "@/features/notifications/lib/notification-display";
import { runNotificationAction } from "@/features/notifications/lib/run-notification-action";
import type { Notification } from "@/features/notifications/services/notifications.service";
import { useOptionalTenant } from "@/features/organizations/providers/tenant-provider";
import { datetime, relativeDatetime } from "@/lib/utils";
import { appToast } from "@/providers/toast-provider";
import { useLocale } from "@/providers/locale-provider";

type NotificationDetailDrawerProps = {
  notification: Notification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `inbox` is the end-user view opened from the bell: title, time, message
   * and actions only. `admin` adds delivery metadata and the raw payload.
   */
  variant?: "inbox" | "admin";
};

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm break-words">{value ?? "—"}</dd>
    </div>
  );
}

function localized(t: (key: string) => string, prefix: string, value: string) {
  const key = `${prefix}.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

/**
 * Platform list has no get-by-id — show fields from the list row.
 */
export function NotificationDetailDrawer({
  notification,
  open,
  onOpenChange,
  variant = "admin",
}: NotificationDetailDrawerProps) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const tenant = useOptionalTenant();
  const actions = notificationActions(notification?.action_url, {
    tenantSlug: tenant?.slug,
    payload: notification?.payload,
  });

  const isInbox = variant === "inbox";

  return (
    <EntityDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={notification?.title ?? t("notifications.detail_title")}
      description={
        isInbox
          ? notification
            ? `${relativeDatetime(notification.created_at, locale)} · ${datetime(notification.created_at, undefined, locale)}`
            : undefined
          : t("notifications.detail_description")
      }
      size={isInbox ? "md" : "lg"}
      footer={
        actions.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            {actions.map((action, index) => (
              <Button
                key={`${action.kind}-${action.href}`}
                type="button"
                variant={index === 0 ? "default" : "outline"}
                onClick={() => {
                  if (isInbox) onOpenChange(false);
                  void runNotificationAction({
                    action,
                    navigate: (href) => router.push(href),
                    notification,
                  }).catch(() => {
                    appToast.error(t("notifications.toast.action_failed"));
                  });
                }}
              >
                {t(action.labelKey)}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    >
      {notification && isInbox ? (
        notification.body ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {formatNotificationText(notification.body, t)}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("notifications.inbox.no_body")}
          </p>
        )
      ) : notification ? (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <StatusChip
              label={localized(t, "notifications.status", notification.status)}
              tone={statusTone(notification.status)}
            />
            <StatusChip
              label={localized(
                t,
                "notifications.priority",
                notification.priority,
              )}
              tone={priorityTone(notification.priority)}
            />
            <StatusChip
              label={localized(
                t,
                "notifications.channel",
                notification.channel,
              )}
              tone="default"
            />
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField
              label={t("notifications.fields.uuid")}
              value={
                <span className="font-mono text-xs">{notification.uuid}</span>
              }
            />
            <DetailField
              label={t("notifications.fields.template_code")}
              value={
                notification.template_code ? (
                  <span className="font-mono text-xs">
                    {notification.template_code}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <DetailField
              label={t("notifications.fields.user")}
              value={
                notification.user
                  ? `${notification.user.name} ${notification.user.surname}`.trim() +
                    ` · ${notification.user.email}`
                  : "—"
              }
            />
            <DetailField
              label={t("notifications.fields.recipient")}
              value={notification.recipient ?? "—"}
            />
            <DetailField
              label={t("notifications.fields.source_event")}
              value={notification.source_event ?? "—"}
            />
            <DetailField
              label={t("notifications.fields.created_at")}
              value={datetime(notification.created_at, undefined, locale)}
            />
            <DetailField
              label={t("notifications.fields.sent_at")}
              value={
                notification.sent_at
                  ? datetime(notification.sent_at, undefined, locale)
                  : "—"
              }
            />
            <DetailField
              label={t("notifications.fields.read_at")}
              value={
                notification.read_at
                  ? datetime(notification.read_at, undefined, locale)
                  : "—"
              }
            />
            <DetailField
              label={t("notifications.fields.action_url")}
              value={notification.action_url ?? "—"}
            />
          </dl>

          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">
              {t("notifications.fields.body")}
            </p>
            <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
              {formatNotificationText(notification.body, t)}
            </pre>
          </div>

          {notification.payload ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium">
                {t("notifications.fields.payload")}
              </p>
              <pre className="bg-muted/40 max-h-48 overflow-auto rounded-md border p-3 text-[11px]">
                {JSON.stringify(notification.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </EntityDrawer>
  );
}
