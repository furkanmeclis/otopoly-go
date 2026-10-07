"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Smartphone,
  Unplug,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/common/status-chip";
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
} from "@/components/ui/dialog";
import {
  whatsappIntegrationService,
  type WhatsAppIntegrationSettings,
} from "@/features/integrations/whatsapp/services/whatsapp-integration.service";
import { WhatsAppQrPanel } from "@/features/messaging/components/whatsapp-qr-panel";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

type Tone = "default" | "success" | "warning" | "danger";

const STATUS_TONES: Record<string, Tone> = {
  connected: "success",
  qr_pending: "warning",
  error: "danger",
  disconnected: "default",
};

const STATUS_KEYS: Record<string, string> = {
  connected: "integrations.whatsapp.session.status_connected",
  qr_pending: "integrations.whatsapp.session.status_qr_pending",
  error: "integrations.whatsapp.session.status_error",
  disconnected: "integrations.whatsapp.session.status_disconnected",
};

export function WhatsAppPlatformSessionCard({
  settings,
  queryKey,
  canWrite,
}: {
  settings: WhatsAppIntegrationSettings;
  queryKey: readonly unknown[];
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const onError = (fallbackKey: string) => (error: unknown) => {
    appToast.error(isApiError(error) ? error.message : t(fallbackKey));
  };

  const connectMutation = useMutation({
    mutationFn: () => whatsappIntegrationService.connectSession(),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: onError("integrations.whatsapp.session.connect_failed"),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => whatsappIntegrationService.disconnectSession(),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setDisconnectOpen(false);
      appToast.success(t("integrations.whatsapp.session.disconnected"));
    },
    onError: onError("integrations.whatsapp.session.disconnect_failed"),
  });

  const status = settings.whatsmeow_status || "disconnected";
  const qrCode = settings.whatsmeow_qr_code?.trim() || "";
  const showQR =
    status === "qr_pending" || (Boolean(qrCode) && status !== "connected");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4" />
          {t("integrations.whatsapp.session.title")}
        </CardTitle>
        <CardDescription>
          {t("integrations.whatsapp.session.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {t("integrations.whatsapp.session.status")}
          </span>
          <StatusChip
            label={STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : status}
            tone={STATUS_TONES[status] ?? "default"}
          />
          {settings.provider !== "whatsmeow" ? (
            <span className="text-muted-foreground text-xs">
              {t("integrations.whatsapp.session.not_active_provider")}
            </span>
          ) : null}
        </div>

        {settings.whatsmeow_error ? (
          <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md px-3 py-2 text-sm">
            <XCircle className="size-4 shrink-0" />
            <span>{settings.whatsmeow_error}</span>
          </div>
        ) : null}

        {showQR ? (
          <WhatsAppQrPanel
            qrCode={qrCode}
            qrExpiresAt={settings.whatsmeow_qr_expires_at}
            pending={status === "qr_pending"}
            refreshing={connectMutation.isPending}
            onRefresh={canWrite ? () => connectMutation.mutate() : undefined}
          />
        ) : null}

        {status === "connected" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-block size-2.5 rounded-full bg-green-500" />
              <p className="text-sm font-medium">
                {settings.whatsmeow_phone ||
                  t("integrations.whatsapp.session.status_connected")}
              </p>
              <CheckCircle2 className="size-4 text-green-600" />
            </div>
            {canWrite ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisconnectOpen(true)}
              >
                <Unplug className="mr-2 size-4" />
                {t("integrations.whatsapp.session.disconnect")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {canWrite && !showQR && status !== "connected" ? (
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
          >
            {connectMutation.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Smartphone className="mr-2 size-4" />
            )}
            {t("integrations.whatsapp.session.connect")}
          </Button>
        ) : null}
      </CardContent>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("integrations.whatsapp.session.disconnect_title")}
            </DialogTitle>
            <DialogDescription>
              {t("integrations.whatsapp.session.disconnect_body")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              {t("integrations.whatsapp.session.disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
