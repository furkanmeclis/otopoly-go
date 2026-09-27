"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  RefreshCw,
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
import {
  useConnectWhatsApp,
  useDisconnectWhatsApp,
  useWhatsAppSession,
} from "@/features/messaging/hooks/use-messaging";
import { useLocale } from "@/providers/locale-provider";

const QR_TTL_SECONDS = 60;

export function WhatsAppSessionCard() {
  const { t } = useLocale();
  const sessionQuery = useWhatsAppSession({
    pollWhilePairing: true,
  });
  const connectMutation = useConnectWhatsApp();
  const disconnectMutation = useDisconnectWhatsApp();

  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const session = sessionQuery.data;
  const status = session?.status ?? "disconnected";
  const qrCode = session?.qr_code?.trim() || "";
  const qrExpiresAt = session?.qr_expires_at;
  const pairing = Boolean(qrCode) && status !== "connected";
  const displayQrUrl = pairing ? qrImageUrl : null;
  const countdown =
    qrExpiresAt && status === "qr_pending"
      ? Math.max(
          0,
          Math.floor((new Date(qrExpiresAt).getTime() - nowMs) / 1000),
        )
      : QR_TTL_SECONDS;

  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    void QRCode.toDataURL(qrCode, { width: 240, margin: 2 }).then((url) => {
      if (!cancelled) setQrImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [pairing, qrCode]);

  useEffect(() => {
    if (!qrExpiresAt || status !== "qr_pending") return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [qrExpiresAt, status]);

  async function handleConnect() {
    await connectMutation.mutateAsync();
  }

  async function handleRefreshQR() {
    await connectMutation.mutateAsync();
  }

  async function handleDisconnect() {
    await disconnectMutation.mutateAsync();
    setDisconnectOpen(false);
  }

  const showQR =
    status === "qr_pending" || (Boolean(qrCode) && status !== "connected");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-green-500" />
          <CardTitle>{t("messaging.wa.title")}</CardTitle>
        </div>
        <CardDescription>{t("messaging.wa.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionQuery.isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>{t("messaging.common.loading")}</span>
          </div>
        ) : null}

        {!sessionQuery.isLoading &&
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
          <div className="space-y-3">
            <div className="bg-muted flex flex-col items-center gap-3 rounded-md border p-4">
              <p className="text-muted-foreground self-start text-xs">
                {t("messaging.wa.scan")}
              </p>
              {displayQrUrl ? (
                // QR is a data URL from qrcode; next/image is not applicable.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayQrUrl}
                  alt={t("messaging.wa.qr_alt")}
                  className="rounded-md"
                  width={240}
                  height={240}
                />
              ) : (
                <div className="flex h-[240px] w-[240px] items-center justify-center">
                  <Loader2 className="text-muted-foreground size-6 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={countdown > 10 ? "secondary" : "danger"}>
                {countdown > 0
                  ? t("messaging.wa.expires_in", { seconds: countdown })
                  : t("messaging.wa.expired")}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefreshQR()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                {t("messaging.wa.refresh")}
              </Button>
            </div>
          </div>
        ) : null}

        {status === "connected" ? (
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
      </CardContent>
    </Card>
  );
}
