"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PlugZap,
  Settings2,
  Unplug,
} from "lucide-react";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EmailIcon } from "@/components/icons/email-icon";
import { NetgsmIcon } from "@/components/icons/netgsm-icon";
import { TwilioIcon } from "@/components/icons/twilio-icon";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SmsProviderDialog } from "@/features/messaging/components/sms-provider-dialog";
import { SmsTestDialog } from "@/features/messaging/components/sms-test-dialog";
import { useWhatsAppSession } from "@/features/messaging/hooks/use-messaging";
import {
  useDisconnectSmsProvider,
  useSetSmsProviderActive,
  useSmsChannel,
  useTestSmsProvider,
} from "@/features/messaging/hooks/use-sms-channel";
import type {
  SmsProviderCode,
  SmsProviderEntry,
} from "@/features/messaging/types";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type BadgeVariant = "success" | "warning" | "danger" | "secondary" | "outline";

const PROVIDER_ICONS: Record<
  SmsProviderCode,
  { Icon: ComponentType<SVGProps<SVGSVGElement>>; className: string }
> = {
  netgsm: { Icon: NetgsmIcon, className: "text-[#0057B8]" },
  twilio: { Icon: TwilioIcon, className: "text-[#F22F46]" },
};

type ChannelsPanelProps = {
  canWrite: boolean;
  /** Opens the WhatsApp connection tab. */
  onManageWhatsApp: () => void;
};

export function ChannelsPanel({
  canWrite,
  onManageWhatsApp,
}: ChannelsPanelProps) {
  const { t } = useLocale();
  const smsQuery = useSmsChannel();
  const [editing, setEditing] = useState<SmsProviderEntry | null>(null);
  const [testing, setTesting] = useState<SmsProviderCode | null>(null);
  const [disconnecting, setDisconnecting] = useState<SmsProviderCode | null>(
    null,
  );
  const disconnect = useDisconnectSmsProvider();
  const overview = smsQuery.data;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          {t("messaging.channels.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("messaging.channels.description")}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WhatsAppChannelCard onManage={onManageWhatsApp} />
        {smsQuery.isLoading ? (
          <>
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </>
        ) : null}
        {smsQuery.isError ? (
          <Card className="md:col-span-2">
            <CardContent className="text-destructive py-6 text-sm">
              {t("messaging.channels.load_failed")}
            </CardContent>
          </Card>
        ) : null}
        {overview?.providers.map((entry) => (
          <SmsProviderCard
            key={entry.provider}
            entry={entry}
            canWrite={canWrite}
            onEdit={() => setEditing(entry)}
            onTestSms={() => setTesting(entry.provider)}
            onDisconnect={() => setDisconnecting(entry.provider)}
          />
        ))}
        <EmailChannelCard />
      </div>

      <SmsProviderDialog
        entry={editing}
        otherActive={Boolean(
          overview?.active_provider &&
          editing &&
          overview.active_provider !== editing.provider,
        )}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <SmsTestDialog
        provider={testing}
        onOpenChange={(open) => {
          if (!open) setTesting(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(disconnecting)}
        title={t("messaging.sms.disconnect.title", {
          provider: disconnecting
            ? t(`messaging.sms.providers.${disconnecting}.name`)
            : "",
        })}
        description={t("messaging.sms.disconnect.body")}
        confirmLabel={t("messaging.sms.disconnect.confirm")}
        variant="destructive"
        isPending={disconnect.isPending}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => {
          if (!disconnecting) return;
          disconnect.mutate(disconnecting, {
            onSettled: () => setDisconnecting(null),
          });
        }}
      />
    </div>
  );
}

function ChannelCardHeader({
  icon,
  title,
  subtitle,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: React.ReactNode;
}) {
  return (
    <CardHeader className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-muted/60 flex size-11 shrink-0 items-center justify-center rounded-xl border">
            {icon}
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-muted-foreground text-xs">{subtitle}</p>
          </div>
        </div>
        {badge}
      </div>
    </CardHeader>
  );
}

function WhatsAppChannelCard({ onManage }: { onManage: () => void }) {
  const { t } = useLocale();
  const session = useWhatsAppSession().data;
  let variant: BadgeVariant = "secondary";
  let label = t("messaging.channels.status.not_connected");
  if (session?.own_number_entitled && session.status === "connected") {
    variant = "success";
    label = t("messaging.channels.status.own_number");
  } else if (session?.platform_sender_available) {
    variant = "success";
    label = t("messaging.channels.status.platform");
  } else if (session?.status === "qr_pending") {
    variant = "warning";
    label = t("messaging.channels.status.pairing");
  }
  return (
    <Card className="flex flex-col">
      <ChannelCardHeader
        icon={<WhatsAppIcon className="size-6 text-[#25D366]" />}
        title={t("messaging.channels.whatsapp.title")}
        subtitle={t("messaging.channels.whatsapp.subtitle")}
        badge={<Badge variant={variant}>{label}</Badge>}
      />
      <CardContent className="flex-1">
        <CardDescription>
          {t("messaging.channels.whatsapp.description")}
        </CardDescription>
        {session?.phone_number && session.status === "connected" ? (
          <p className="mt-3 font-mono text-xs">{session.phone_number}</p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" onClick={onManage}>
          <Settings2 className="mr-2 size-4" />
          {t("messaging.channels.whatsapp.manage")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function EmailChannelCard() {
  const { t } = useLocale();
  return (
    <Card className="flex flex-col">
      <ChannelCardHeader
        icon={<EmailIcon className="size-6 text-sky-600" />}
        title={t("messaging.channels.email.title")}
        subtitle={t("messaging.channels.email.subtitle")}
        badge={
          <Badge variant="success">
            {t("messaging.channels.status.platform")}
          </Badge>
        }
      />
      <CardContent className="flex-1">
        <CardDescription>
          {t("messaging.channels.email.description")}
        </CardDescription>
      </CardContent>
    </Card>
  );
}

function SmsProviderCard({
  entry,
  canWrite,
  onEdit,
  onTestSms,
  onDisconnect,
}: {
  entry: SmsProviderEntry;
  canWrite: boolean;
  onEdit: () => void;
  onTestSms: () => void;
  onDisconnect: () => void;
}) {
  const { t, locale } = useLocale();
  const test = useTestSmsProvider();
  const setActive = useSetSmsProviderActive();
  const account = entry.account;
  const { Icon, className } = PROVIDER_ICONS[entry.provider];
  const name = t(`messaging.sms.providers.${entry.provider}.name`);

  let variant: BadgeVariant = "secondary";
  let label = t("messaging.channels.status.not_connected");
  if (account) {
    if (account.status === "error") {
      variant = "danger";
      label = t("messaging.channels.status.error");
    } else if (account.is_active) {
      variant = "success";
      label = t("messaging.channels.status.active");
    } else {
      variant = "outline";
      label = t("messaging.channels.status.inactive");
    }
  }

  return (
    <Card className="flex flex-col">
      <ChannelCardHeader
        icon={<Icon className={`size-6 ${className}`} />}
        title={t("messaging.channels.sms.title", { provider: name })}
        subtitle={t(`messaging.sms.providers.${entry.provider}.subtitle`)}
        badge={<Badge variant={variant}>{label}</Badge>}
      />
      <CardContent className="flex-1 space-y-3">
        <CardDescription>
          {t(`messaging.sms.providers.${entry.provider}.description`)}
        </CardDescription>
        {account ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">
              {t(`messaging.sms.sender.${entry.sender_kind}`)}
            </dt>
            <dd className="truncate font-mono">{account.sender}</dd>
            {entry.fields
              .filter((f) => account.credential_hints?.[f.key])
              .map((f) => (
                <FragmentRow
                  key={f.key}
                  label={t(`messaging.sms.fields.${f.key}`)}
                  value={account.credential_hints[f.key] ?? ""}
                />
              ))}
            {account.last_checked_at ? (
              <FragmentRow
                label={t("messaging.sms.last_checked")}
                value={datetime(
                  account.last_checked_at,
                  "dd.MM.yyyy HH:mm",
                  locale,
                )}
              />
            ) : null}
          </dl>
        ) : null}
        {account?.status === "error" && account.last_error ? (
          <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-xs">
            {account.last_error}
          </p>
        ) : null}
        {account ? (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {t("messaging.sms.use_as_channel")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("messaging.sms.use_as_channel_hint")}
              </p>
            </div>
            <Switch
              checked={account.is_active}
              disabled={!canWrite || setActive.isPending}
              onCheckedChange={(checked) =>
                setActive.mutate({
                  provider: entry.provider,
                  isActive: checked,
                })
              }
              aria-label={t("messaging.sms.use_as_channel")}
            />
          </div>
        ) : null}
      </CardContent>
      {canWrite ? (
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={account ? "outline" : "default"}
            onClick={onEdit}
          >
            {account ? (
              <Settings2 className="mr-2 size-4" />
            ) : (
              <PlugZap className="mr-2 size-4" />
            )}
            {account ? t("messaging.sms.edit") : t("messaging.sms.connect")}
          </Button>
          {account ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={test.isPending}
                onClick={() => test.mutate(entry.provider)}
              >
                {test.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 size-4" />
                )}
                {t("messaging.sms.test_connection")}
              </Button>
              <Button size="sm" variant="outline" onClick={onTestSms}>
                <MessageSquareText className="mr-2 size-4" />
                {t("messaging.sms.send_test")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onDisconnect}>
                <Unplug className="mr-2 size-4" />
                {t("messaging.sms.disconnect.action")}
              </Button>
            </>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono">{value}</dd>
    </>
  );
}
