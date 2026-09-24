"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { permissions } from "@/config/permissions";
import { AISettingsForm } from "@/features/ai/components/platform/ai-settings-form";
import { AIUsageTable } from "@/features/ai/components/platform/ai-usage-table";
import { aiKeys } from "@/features/ai/hooks/query-keys";
import type { AISettingsFormValues } from "@/features/ai/schemas/ai-settings-form";
import { aiPlatformService } from "@/features/ai/services/ai.service";
import type { AISettings, AISettingsPatch } from "@/features/ai/types";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { appToast } from "@/providers/toast-provider";

function toPatch(
  values: AISettingsFormValues,
  settings: AISettings,
): AISettingsPatch {
  const tools: Record<string, boolean> = {};
  for (const tool of settings.tools) {
    const next = values.tools[tool.name] ?? true;
    if (next !== tool.enabled) tools[tool.name] = next;
  }
  return {
    provider: values.provider,
    ...(values.api_key?.trim() ? { api_key: values.api_key.trim() } : {}),
    ...(values.clear_api_key ? { clear_api_key: true } : {}),
    base_url: values.base_url,
    model: values.model,
    title_model: values.title_model,
    effort: values.effort,
    max_tokens: values.max_tokens,
    features: {
      chat: values.feature_chat,
      charts: values.feature_charts,
      actions: values.feature_actions,
      todos: values.feature_todos,
      voice: values.feature_voice,
    },
    ...(Object.keys(tools).length ? { tools } : {}),
    extra_instructions: values.extra_instructions,
    default_monthly_token_quota: values.default_monthly_token_quota,
    voice: {
      base_url: values.voice_base_url,
      stt_model: values.voice_stt_model,
      tts_voice: values.voice_tts_voice,
      language: values.voice_language,
    },
  };
}

export function AISettingsPage() {
  const { t } = useLocale();
  const { can } = usePermission();
  const queryClient = useQueryClient();
  const canRead = can(permissions.ai.read);
  const canWrite = can(permissions.ai.write);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: aiKeys.settings(),
    queryFn: () => aiPlatformService.getSettings(),
    enabled: canRead,
  });

  const saveMutation = useMutation({
    mutationFn: (values: AISettingsFormValues) =>
      aiPlatformService.patchSettings(toPatch(values, data as AISettings)),
    onSuccess: (next) => {
      queryClient.setQueryData(aiKeys.settings(), next);
      appToast.success(t("ai.toast.saved"));
    },
    onError: (error) => {
      appToast.error(isApiError(error) ? error.message : t("ai.toast.failed"));
    },
  });

  const testMutation = useMutation({
    mutationFn: () => aiPlatformService.testConnection(),
    onSuccess: (res) => {
      if (res.ok) {
        appToast.success(t("ai.test.ok", { ms: res.latency_ms }));
      } else {
        appToast.error(t("ai.test.failed", { message: res.message ?? "" }));
      }
    },
  });

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("ai.forbidden")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Sparkles className="size-7" />}
        title={t("ai.title")}
        description={t("ai.description")}
        actions={
          data ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant={data.configured ? "success" : "warning"}>
                {data.configured
                  ? t("ai.status.configured")
                  : t("ai.status.not_configured")}
              </Badge>
              <Badge variant={data.features.chat ? "success" : "outline"}>
                {data.features.chat
                  ? t("ai.status.enabled")
                  : t("ai.status.disabled")}
              </Badge>
            </div>
          ) : null
        }
      />

      {isLoading ? <Loading label={t("common.loading")} /> : null}
      {isError ? (
        <ErrorState
          title={t("ai.error.title")}
          description={t("ai.error.description")}
          retryLabel={t("common.retry")}
          onRetry={() => refetch()}
        />
      ) : null}

      {data ? (
        <AISettingsForm
          settings={data}
          canWrite={canWrite}
          isSaving={saveMutation.isPending}
          isTesting={testMutation.isPending}
          onSubmit={async (values) => {
            await saveMutation.mutateAsync(values);
          }}
          onTest={() => testMutation.mutate()}
        />
      ) : null}

      {data ? <AIUsageTable /> : null}
    </div>
  );
}
