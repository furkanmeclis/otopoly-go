"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Lock,
  MessageCircle,
  Unplug,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WhatsAppQrPanel } from "@/features/messaging/components/whatsapp-qr-panel";
import {
  useConnectWhatsApp,
  useDisconnectWhatsApp,
  useUpdateSessionSettings,
  useWhatsAppSession,
} from "@/features/messaging/hooks/use-messaging";
import { useLocale } from "@/providers/locale-provider";

type WhatsAppSessionCardProps = {
  /** Owner with `tenant.messaging.write` (routing settings). */
  canWrite?: boolean;
};

export function WhatsAppSessionCard({
  canWrite = false,
}: WhatsAppSessionCardProps) {
  const { t } = useLocale();
  const sessionQuery = useWhatsAppSession({
    pollWhilePairing: true,
  });
  const connectMutation = useConnectWhatsApp();
  const disconnectMutation = useDisconnectWhatsApp();
  const settingsMutation = useUpdateSessionSettings();

  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const session = sessionQuery.data;
  const entitled = session?.own_number_entitled ?? false;
  const status = session?.status ?? "disconnected";
  const qrCode = session?.qr_code?.trim() || "";
  const showQR =
    entitled &&
    (status === "qr_pending" || (Boolean(qrCode) && status !== "connected"));

  async function handleConnect() {
    await connectMutation.mutateAsync();
  }

  async function handleDisconnect() {
    await disconnectMutation.mutateAsync();
    setDisconnectOpen(false);
  }

  const platformBadge = session ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        {t("messaging.wa.platform_sender")}
      </span>
      <Badge
        variant={session.platform_sender_available ? "success" : "warning"}
      >
        {session.platform_sender_available
          ? t("messaging.wa.platform_available")
          : t("messaging.wa.platform_unavailable")}
      </Badge>
    </div>
  ) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-green-500" />
          <CardTitle>{t("messaging.wa.title")}</CardTitle>
        </div>
        <CardDescription>
          {session && !entitled
            ? t("messaging.wa.description_platform")
            : t("messaging.wa.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionQuery.isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>{t("messaging.common.loading")}</span>
          </div>
        ) : null}

        {session && !entitled ? (
          <div className="space-y-3">
            <div className="bg-muted/50 flex items-start gap-3 rounded-md border p-3 text-sm">
              <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">{t("messaging.wa.locked_title")}</p>
                <p className="text-muted-foreground">
                  {t("messaging.wa.locked_body")}
                </p>
              </div>
            </div>
            {platformBadge}
          </div>
        ) : null}

        {entitled &&
        !sessionQuery.isLoading &&
        (status === "disconnected" || status === "error") &&
        !showQR ? (
          <div className="space-y-3">
            {status === "error" && session?.error_message ? (
              <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md px-3 py-2 text-sm">
                <XCircle className="size-4 shrink-0" />
                <span>{session.error_message}</span>
              </div>
            ) : null}
            <Button
              onClick={() => void handleConnect()}
              disabled={connectMutation.isPending}
            >
              {connectMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <MessageCircle className="mr-2 size-4" />
              )}
              {t("messaging.wa.connect")}
            </Button>
          </div>
        ) : null}

        {showQR ? (
          <WhatsAppQrPanel
            qrCode={qrCode}
            qrExpiresAt={session?.qr_expires_at}
            pending={status === "qr_pending"}
            refreshing={connectMutation.isPending}
            onRefresh={() => void handleConnect()}
          />
        ) : null}

        {entitled && status === "connected" ? (
          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-block size-2.5 rounded-full bg-green-500" />
              <div>
                {session?.display_name ? (
                  <p className="text-sm font-medium">{session.display_name}</p>
                ) : null}
                {session?.phone_number ? (
                  <p className="text-muted-foreground text-xs">
                    {session.phone_number}
                  </p>
                ) : null}
                {!session?.display_name && !session?.phone_number ? (
                  <p className="text-muted-foreground text-sm">
                    {t("messaging.wa.connected")}
                  </p>
                ) : null}
              </div>
              <CheckCircle2 className="size-4 text-green-600" />
            </div>
            <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Unplug className="mr-2 size-4" />
                  {t("messaging.wa.disconnect")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {t("messaging.wa.disconnect_title")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("messaging.wa.disconnect_body")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDisconnectOpen(false)}
                  >
                    {t("messaging.wa.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void handleDisconnect()}
                    disabled={disconnectMutation.isPending}
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    {t("messaging.wa.disconnect")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}

        {session && entitled ? (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="wa-fallback-to-platform">
                  {t("messaging.wa.fallback_label")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("messaging.wa.fallback_hint")}
                </p>
              </div>
              <Switch
                id="wa-fallback-to-platform"
                checked={session.fallback_to_platform}
                onCheckedChange={(checked) => settingsMutation.mutate(checked)}
                disabled={!canWrite || settingsMutation.isPending}
              />
            </div>
            {platformBadge}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
