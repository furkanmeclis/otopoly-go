"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { messagingKeys } from "@/features/messaging/hooks/use-messaging";
import { sendErrorLabel } from "@/features/messaging/lib/send-errors";
import { smsService } from "@/features/messaging/services/sms.service";
import type {
  SaveSmsProviderInput,
  SmsProviderCode,
  SmsTestSmsInput,
} from "@/features/messaging/types";
import { useLocale } from "@/providers/locale-provider";

export const smsKeys = {
  overview: () => [...messagingKeys.all, "sms"] as const,
};

export function useSmsChannel(enabled = true) {
  return useQuery({
    queryKey: smsKeys.overview(),
    queryFn: () => smsService.overview(),
    enabled,
  });
}

/** True when the organization has an active SMS provider. */
export function useSmsAvailable() {
  const query = useSmsChannel();
  return Boolean(query.data?.active_provider);
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: smsKeys.overview() });
    // Channel availability feeds the daily summary / vehicle alert cards.
    void queryClient.invalidateQueries({ queryKey: messagingKeys.all });
  };
}

export function useSaveSmsProvider() {
  const { t } = useLocale();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      provider,
      body,
    }: {
      provider: SmsProviderCode;
      body: SaveSmsProviderInput;
    }) => smsService.save(provider, body),
    onSuccess: () => {
      invalidate();
      toast.success(t("messaging.sms.toast.saved"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.sms.toast.save_failed")),
  });
}

export function useSetSmsProviderActive() {
  const { t } = useLocale();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      provider,
      isActive,
    }: {
      provider: SmsProviderCode;
      isActive: boolean;
    }) => smsService.setActive(provider, isActive),
    onSuccess: (account) => {
      invalidate();
      toast.success(
        account.is_active
          ? t("messaging.sms.toast.enabled")
          : t("messaging.sms.toast.disabled"),
      );
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.sms.toast.save_failed")),
  });
}

export function useDisconnectSmsProvider() {
  const { t } = useLocale();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (provider: SmsProviderCode) => smsService.disconnect(provider),
    onSuccess: () => {
      invalidate();
      toast.success(t("messaging.sms.toast.disconnected"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.sms.toast.disconnect_failed")),
  });
}

export function useTestSmsProvider() {
  const { t } = useLocale();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (provider: SmsProviderCode) => smsService.test(provider),
    onSuccess: (result) => {
      invalidate();
      if (result.ok) {
        const detail = [result.detail, result.balance]
          .filter(Boolean)
          .join(" · ");
        toast.success(
          detail
            ? t("messaging.sms.toast.test_ok_detail", { detail })
            : t("messaging.sms.toast.test_ok"),
        );
      } else {
        toast.error(
          t("messaging.sms.toast.test_failed", {
            reason:
              sendErrorLabel(t, result.error_code) || result.message || "",
          }),
        );
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.sms.toast.test_error")),
  });
}

export function useSendTestSms() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      body,
    }: {
      provider: SmsProviderCode;
      body: SmsTestSmsInput;
    }) => smsService.sendTest(provider, body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: [...messagingKeys.all, "outbound"],
      });
      if (result.status === "sent") {
        toast.success(
          t("messaging.sms.toast.test_sms_sent", {
            recipient: result.recipient,
          }),
        );
      } else {
        toast.error(
          t("messaging.sms.toast.test_sms_failed", {
            reason:
              sendErrorLabel(t, result.error_code) ||
              result.error_message ||
              "",
          }),
        );
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || t("messaging.sms.toast.test_error")),
  });
}
