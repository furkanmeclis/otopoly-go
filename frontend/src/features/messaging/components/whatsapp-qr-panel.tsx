"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";

const QR_TTL_SECONDS = 60;

type WhatsAppQrPanelProps = {
  /** Raw pairing payload from whatsmeow (rendered locally as a QR image). */
  qrCode: string;
  qrExpiresAt?: string | null;
  /** Countdown runs only while the status is `qr_pending`. */
  pending: boolean;
  refreshing: boolean;
  onRefresh?: () => void;
};

/**
 * WhatsApp linked-device QR with expiry countdown. Shared by the tenant
 * own-number card and the platform number card (both poll their GET
 * endpoint while `qr_pending`).
 */
export function WhatsAppQrPanel({
  qrCode,
  qrExpiresAt,
  pending,
  refreshing,
  onRefresh,
}: WhatsAppQrPanelProps) {
  const { t } = useLocale();
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const countdown =
    qrExpiresAt && pending
      ? Math.max(
          0,
          Math.floor((new Date(qrExpiresAt).getTime() - nowMs) / 1000),
        )
      : QR_TTL_SECONDS;

  useEffect(() => {
    if (!qrCode) return;
    let cancelled = false;
    void QRCode.toDataURL(qrCode, { width: 240, margin: 2 }).then((url) => {
      if (!cancelled) setQrImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qrCode]);

  useEffect(() => {
    if (!qrExpiresAt || !pending) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [qrExpiresAt, pending]);

  const displayQrUrl = qrCode ? qrImageUrl : null;

  return (
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
        {onRefresh ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            {t("messaging.wa.refresh")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
