"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { permissions } from "@/config/permissions";
import { leadsKeys } from "@/features/leads/hooks/use-leads";
import { quotesService } from "@/features/quotes/services/quotes.service";
import type {
  ConvertQuoteInput,
  QuoteDetail,
  QuoteListParams,
  QuoteReminderInput,
  SaveQuoteInput,
  SendQuoteInput,
} from "@/features/quotes/types";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export const quotesKeys = {
  all: ["tenant", "quotes"] as const,
  list: (params?: QuoteListParams) =>
    [...quotesKeys.all, "list", params] as const,
  summary: () => [...quotesKeys.all, "summary"] as const,
  detail: (uuid: string) => [...quotesKeys.all, "detail", uuid] as const,
  convert: (uuid: string) => [...quotesKeys.all, "convert", uuid] as const,
};

export function useQuotesAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.quotes.read),
    canWrite: hasPermission(permissions.quotes.write),
    canConvert:
      hasPermission(permissions.quotes.write) &&
      hasPermission(permissions.jobs.write),
  };
}

export function useQuotes(params: QuoteListParams, enabled = true) {
  return useQuery({
    queryKey: quotesKeys.list(params),
    queryFn: () => quotesService.list(params),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useQuoteSummary(enabled = true) {
  return useQuery({
    queryKey: quotesKeys.summary(),
    queryFn: () => quotesService.summary(),
    enabled,
    refetchInterval: 120_000,
  });
}

export function useQuote(uuid: string) {
  return useQuery({
    queryKey: quotesKeys.detail(uuid),
    queryFn: () => quotesService.get(uuid),
    enabled: Boolean(uuid),
  });
}

export function useConvertPreview(uuid: string, enabled: boolean) {
  return useQuery({
    queryKey: quotesKeys.convert(uuid),
    queryFn: () => quotesService.convertPreview(uuid),
    enabled: Boolean(uuid) && enabled,
    staleTime: 0,
  });
}

export function useQuoteMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const store = (quote: QuoteDetail) => {
    qc.setQueryData(quotesKeys.detail(quote.uuid), quote);
    void qc.invalidateQueries({ queryKey: [...quotesKeys.all, "list"] });
    void qc.invalidateQueries({ queryKey: quotesKeys.summary() });
    void qc.invalidateQueries({ queryKey: leadsKeys.all });
  };
  return {
    create: useMutation({
      mutationFn: (body: SaveQuoteInput) => quotesService.create(body),
      onSuccess: (q) => {
        toast.success(t("quotes.toast.created", { number: q.number }));
        store(q);
      },
    }),
    update: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: SaveQuoteInput }) =>
        quotesService.update(uuid, body),
      onSuccess: (q) => {
        toast.success(t("quotes.toast.saved"));
        store(q);
      },
    }),
    duplicate: useMutation({
      mutationFn: (uuid: string) => quotesService.duplicate(uuid),
      onSuccess: (q) => {
        toast.success(t("quotes.toast.created", { number: q.number }));
        store(q);
      },
    }),
    setStatus: useMutation({
      mutationFn: ({
        uuid,
        status,
        note,
      }: {
        uuid: string;
        status: string;
        note?: string;
      }) => quotesService.setStatus(uuid, status, note),
      onSuccess: (q) => {
        toast.success(
          t("quotes.toast.status", { status: t(`quotes.status.${q.status}`) }),
        );
        store(q);
      },
    }),
    send: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: SendQuoteInput }) =>
        quotesService.send(uuid, body),
      onSuccess: (res) => {
        if (res.delivery.status === "sent") {
          toast.success(t("quotes.toast.sent"));
        } else {
          toast.warning(t("quotes.toast.send_failed"), {
            description:
              res.delivery.error === "not configured"
                ? t("quotes.send.not_configured")
                : res.delivery.error,
          });
        }
        store(res.quote);
      },
    }),
    retry: useMutation({
      mutationFn: ({
        uuid,
        deliveryUuid,
      }: {
        uuid: string;
        deliveryUuid: string;
      }) => quotesService.retryDelivery(uuid, deliveryUuid),
      onSuccess: (res) => {
        if (res.delivery.status === "sent")
          toast.success(t("quotes.toast.sent"));
        else
          toast.warning(t("quotes.toast.send_failed"), {
            description:
              res.delivery.error === "not configured"
                ? t("quotes.send.not_configured")
                : res.delivery.error,
          });
        store(res.quote);
      },
    }),
    setReminders: useMutation({
      mutationFn: ({
        uuid,
        reminders,
      }: {
        uuid: string;
        reminders: QuoteReminderInput[];
      }) => quotesService.setReminders(uuid, reminders),
      onSuccess: (q) => {
        toast.success(t("quotes.toast.reminders"));
        store(q);
      },
    }),
    convert: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: ConvertQuoteInput }) =>
        quotesService.convert(uuid, body),
      onSuccess: (res) => {
        toast.success(t("quotes.toast.converted"));
        store(res.quote);
        void qc.invalidateQueries({ queryKey: ["tenant", "jobs"] });
      },
    }),
  };
}
