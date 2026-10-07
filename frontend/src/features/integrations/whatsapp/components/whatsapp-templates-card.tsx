"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  whatsappIntegrationService,
  type WhatsAppCloudTemplate,
  type WhatsAppTemplateSubmit,
} from "@/features/integrations/whatsapp/services/whatsapp-integration.service";
import { sendErrorLabel } from "@/features/messaging/lib/send-errors";
import { isApiError } from "@/lib/api";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

type Tone = "default" | "success" | "warning" | "danger";

const STATUS_TONES: Record<WhatsAppCloudTemplate["status"], Tone> = {
  not_submitted: "default",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  paused: "warning",
  disabled: "danger",
};

const STATUS_KEYS: Record<WhatsAppCloudTemplate["status"], string> = {
  not_submitted: "integrations.whatsapp.templates.status.not_submitted",
  pending: "integrations.whatsapp.templates.status.pending",
  approved: "integrations.whatsapp.templates.status.approved",
  rejected: "integrations.whatsapp.templates.status.rejected",
  paused: "integrations.whatsapp.templates.status.paused",
  disabled: "integrations.whatsapp.templates.status.disabled",
};

const OVERRIDE_RE = /^[a-z0-9_]{1,512}$/;

function canSubmit(tpl: WhatsAppCloudTemplate) {
  return tpl.status === "not_submitted" && !tpl.override_name;
}

export function WhatsAppTemplatesCard({
  templates,
  isLoading,
  isError,
  onRetry,
  queryKey,
  canWrite,
}: {
  templates: WhatsAppCloudTemplate[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  queryKey: readonly unknown[];
  canWrite: boolean;
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState("");
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const apiErrorMessage = (error: unknown, fallbackKey: string) => {
    if (isApiError(error)) {
      const code = error.code?.toLowerCase();
      return code && error.status === 409
        ? `${sendErrorLabel(t, code)} (${error.code})`
        : error.message;
    }
    return t(fallbackKey);
  };

  const reportSubmit = (data: WhatsAppTemplateSubmit) => {
    queryClient.setQueryData(queryKey, data.items);
    const failed = data.results.filter((r) => r.error);
    const submitted = data.results.filter((r) => !r.error && !r.skipped);
    if (failed.length === 0) {
      appToast.success(
        t("integrations.whatsapp.templates.submitted", {
          count: submitted.length,
        }),
      );
      return;
    }
    appToast.error(
      t("integrations.whatsapp.templates.submit_partial", {
        ok: submitted.length,
        failed: failed.length,
        details: failed
          .map((r) => `${r.key}: ${sendErrorLabel(t, r.error)}`)
          .join(", "),
      }),
    );
  };

  const submitMutation = useMutation({
    mutationFn: (keys?: string[]) =>
      whatsappIntegrationService.submitTemplates(keys),
    onSuccess: reportSubmit,
    onError: (error) =>
      appToast.error(
        apiErrorMessage(error, "integrations.whatsapp.templates.submit_failed"),
      ),
    onSettled: () => setSubmittingKey(null),
  });

  const syncMutation = useMutation({
    mutationFn: () => whatsappIntegrationService.syncTemplates(),
    onSuccess: (items) => {
      queryClient.setQueryData(queryKey, items);
      appToast.success(t("integrations.whatsapp.templates.synced"));
    },
    onError: (error) =>
      appToast.error(
        apiErrorMessage(error, "integrations.whatsapp.templates.sync_failed"),
      ),
  });

  const overrideMutation = useMutation({
    mutationFn: ({ key, name }: { key: string; name: string | null }) =>
      whatsappIntegrationService.setOverride(key, name),
    onSuccess: (updated) => {
      queryClient.setQueryData<WhatsAppCloudTemplate[]>(queryKey, (prev) =>
        prev?.map((tpl) => (tpl.key === updated.key ? updated : tpl)),
      );
      setEditingKey(null);
      appToast.success(t("integrations.whatsapp.templates.override_saved"));
    },
    onError: (error) =>
      appToast.error(
        apiErrorMessage(
          error,
          "integrations.whatsapp.templates.override_failed",
        ),
      ),
  });

  const draft = overrideDraft.trim();
  const draftInvalid = draft !== "" && !OVERRIDE_RE.test(draft);
  const pendingSubmitCount = templates.filter(canSubmit).length;
  const busy = submitMutation.isPending || syncMutation.isPending;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            {t("integrations.whatsapp.templates.title")}
          </CardTitle>
          <CardDescription>
            {t("integrations.whatsapp.templates.description")}
          </CardDescription>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={busy}
            >
              {syncMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              {t("integrations.whatsapp.templates.sync")}
            </Button>
            <Button
              size="sm"
              onClick={() => submitMutation.mutate(undefined)}
              disabled={busy || pendingSubmitCount === 0}
            >
              {submitMutation.isPending && submittingKey === null ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              {t("integrations.whatsapp.templates.submit_all", {
                count: pendingSubmitCount,
              })}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("integrations.whatsapp.templates.error")}
            onRetry={onRetry}
            retryLabel={t("common.retry")}
          />
        ) : templates.length === 0 ? (
          <EmptyState title={t("integrations.whatsapp.templates.empty")} />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {t("integrations.whatsapp.templates.columns.key")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("integrations.whatsapp.templates.columns.meta_name")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("integrations.whatsapp.templates.columns.override")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("integrations.whatsapp.templates.columns.category")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("integrations.whatsapp.templates.columns.language")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("integrations.whatsapp.templates.columns.status")}
                  </th>
                  {canWrite ? (
                    <th className="px-3 py-2 text-right font-medium">
                      {t("common.actions")}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {templates.map((tpl) => {
                  const editing = editingKey === tpl.key;
                  return (
                    <tr key={tpl.key} className="align-top">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{tpl.key}</span>
                        <p
                          className="text-muted-foreground mt-1 line-clamp-2 max-w-xs text-xs"
                          title={tpl.body}
                        >
                          {tpl.body}
                        </p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {tpl.meta_name}
                      </td>
                      <td className="px-3 py-2">
                        {editing ? (
                          <form
                            className="flex min-w-56 items-start gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (draftInvalid) return;
                              overrideMutation.mutate({
                                key: tpl.key,
                                name: draft || null,
                              });
                            }}
                          >
                            <div className="flex-1 space-y-1">
                              <Input
                                autoFocus
                                value={overrideDraft}
                                onChange={(e) =>
                                  setOverrideDraft(e.target.value)
                                }
                                placeholder={tpl.meta_name}
                                className="h-8 font-mono text-xs"
                                aria-invalid={draftInvalid}
                                aria-label={t(
                                  "integrations.whatsapp.templates.columns.override",
                                )}
                              />
                              {draftInvalid ? (
                                <p className="text-destructive text-xs">
                                  {t(
                                    "integrations.whatsapp.templates.override_invalid",
                                  )}
                                </p>
                              ) : (
                                <p className="text-muted-foreground text-xs">
                                  {t(
                                    "integrations.whatsapp.templates.override_hint",
                                  )}
                                </p>
                              )}
                            </div>
                            <Button
                              type="submit"
                              size="icon-sm"
                              variant="ghost"
                              disabled={
                                draftInvalid || overrideMutation.isPending
                              }
                              aria-label={t("common.save")}
                            >
                              {overrideMutation.isPending ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Check className="size-4" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setEditingKey(null)}
                              aria-label={t("common.cancel")}
                            >
                              <X className="size-4" />
                            </Button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-1">
                            {tpl.override_name ? (
                              <span className="font-mono text-xs">
                                {tpl.override_name}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {canWrite ? (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => {
                                  setOverrideDraft(tpl.override_name ?? "");
                                  setEditingKey(tpl.key);
                                }}
                                aria-label={t(
                                  "integrations.whatsapp.templates.edit_override",
                                )}
                                title={t(
                                  "integrations.whatsapp.templates.edit_override",
                                )}
                              >
                                <Pencil className="size-3" />
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{tpl.category}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs uppercase">
                        {tpl.language}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <StatusChip
                            label={t(STATUS_KEYS[tpl.status])}
                            tone={STATUS_TONES[tpl.status]}
                          />
                          {tpl.status === "rejected" && tpl.rejected_reason ? (
                            <span className="text-destructive max-w-48 text-xs">
                              {tpl.rejected_reason}
                            </span>
                          ) : null}
                          {tpl.last_synced_at ? (
                            <span className="text-muted-foreground text-[11px] whitespace-nowrap">
                              {t("integrations.whatsapp.templates.synced_at", {
                                date: datetime(
                                  tpl.last_synced_at,
                                  "dd.MM.yyyy HH:mm",
                                  locale,
                                ),
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      {canWrite ? (
                        <td className="px-3 py-2 text-right">
                          {canSubmit(tpl) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setSubmittingKey(tpl.key);
                                submitMutation.mutate([tpl.key]);
                              }}
                            >
                              {submitMutation.isPending &&
                              submittingKey === tpl.key ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                              ) : (
                                <Upload className="mr-2 size-4" />
                              )}
                              {t("integrations.whatsapp.templates.submit")}
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
