"use client";

import { useEffect, useRef, useState } from "react";
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

const QR_TTL_SECONDS = 30;

export function WhatsAppSessionCard() {
  const sessionQuery = useWhatsAppSession();
  const connectMutation = useConnectWhatsApp();
  const disconnectMutation = useDisconnectWhatsApp();

  const [qrData, setQrData] = useState<{
    code: string;
    expires_at: string;
  } | null>(null);
  const [countdown, setCountdown] = useState(QR_TTL_SECONDS);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const session = sessionQuery.data;
  const status = session?.status ?? "disconnected";

  // Start countdown when QR code is active
  useEffect(() => {
    if (qrData) {
      const expiresMs =
        new Date(qrData.expires_at).getTime() - Date.now();
      const seconds = Math.max(
        0,
        Math.floor(expiresMs / 1000),
      );
      setCountdown(seconds > 0 ? seconds : QR_TTL_SECONDS);

      intervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [qrData]);

  async function handleConnect() {
    const result = await connectMutation.mutateAsync();
    setQrData(result);
    setCountdown(QR_TTL_SECONDS);
  }

  async function handleRefreshQR() {
    const result = await connectMutation.mutateAsync();
    setQrData(result);
    setCountdown(QR_TTL_SECONDS);
  }

  async function handleDisconnect() {
    await disconnectMutation.mutateAsync();
    setQrData(null);
    setDisconnectOpen(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-green-500" />
          <CardTitle>WhatsApp Bağlantısı</CardTitle>
        </div>
        <CardDescription>
          Müşterilere WhatsApp üzerinden otomatik bildirim göndermek için
          WhatsApp hesabınızı bağlayın.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessionQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>Yükleniyor...</span>
          </div>
        ) : null}

        {/* Disconnected / Error state */}
        {!sessionQuery.isLoading &&
        (status === "disconnected" || status === "error") &&
        !qrData ? (
          <div className="space-y-3">
            {status === "error" && session?.error_message ? (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <XCircle className="size-4 shrink-0" />
                <span>{session.error_message}</span>
              </div>
            ) : null}
            <Button
              onClick={handleConnect}
              disabled={connectMutation.isPending}
            >
              {connectMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <MessageCircle className="mr-2 size-4" />
              )}
              WhatsApp Bağla
            </Button>
          </div>
        ) : null}

        {/* QR Pending state */}
        {(status === "qr_pending" || qrData) && status !== "connected" ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-4">
              <p className="mb-1 text-xs text-muted-foreground">
                WhatsApp uygulamanızdan bu kodu okutun:
              </p>
              <code className="block break-all text-sm font-mono select-all">
                {qrData?.code ?? session?.jid ?? "—"}
              </code>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant={countdown > 10 ? "secondary" : "danger"}
              >
                {countdown > 0 ? `${countdown}s kaldı` : "Süresi doldu"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshQR}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                Yenile
              </Button>
            </div>
          </div>
        ) : null}

        {/* Connected state */}
        {status === "connected" && !qrData ? (
          <div className="flex items-center justify-between rounded-md border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-block size-2.5 rounded-full bg-green-500" />
              <div>
                {session?.display_name ? (
                  <p className="font-medium text-sm">{session.display_name}</p>
                ) : null}
                {session?.phone_number ? (
                  <p className="text-xs text-muted-foreground">
                    {session.phone_number}
                  </p>
                ) : null}
                {!session?.display_name && !session?.phone_number ? (
                  <p className="text-sm text-muted-foreground">Bağlı</p>
                ) : null}
              </div>
            </div>
            <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Unplug className="mr-2 size-4" />
                  Bağlantıyı Kes
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>WhatsApp Bağlantısını Kes</DialogTitle>
                  <DialogDescription>
                    Bu işlem WhatsApp oturumunu sonlandırır ve otomatik
                    bildirimler gönderilmez. Devam etmek istiyor musunuz?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDisconnectOpen(false)}
                  >
                    İptal
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDisconnect}
                    disabled={disconnectMutation.isPending}
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Bağlantıyı Kes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}

        {/* Session reconnected after QR */}
        {status === "connected" && qrData ? (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle2 className="size-4" />
            <span>WhatsApp başarıyla bağlandı!</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
