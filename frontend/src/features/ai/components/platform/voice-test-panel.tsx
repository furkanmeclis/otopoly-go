"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { aiVoiceService } from "@/features/ai/services/voice.service";
import { useLocale } from "@/providers/locale-provider";

type VoiceValues = { base_url: string; stt_model: string; tts_voice: string };

function ModelRow({
  label,
  model,
  installed,
}: {
  label: string;
  model: string;
  installed: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {installed ? (
        <CheckCircle2 className="size-3.5 text-emerald-600" />
      ) : (
        <XCircle className="text-destructive size-3.5" />
      )}
      <span className="text-muted-foreground">{label}</span>
      <code className="bg-muted rounded px-1.5 py-0.5">{model}</code>
      <Badge variant={installed ? "success" : "danger"}>
        {installed ? t("ai.voice_test.installed") : t("ai.voice_test.missing")}
      </Badge>
    </div>
  );
}

/**
 * Checks the Speaches server with the values currently in the form (saved
 * or not) and shows which configured models are installed.
 */
export function VoiceTestPanel({
  getValues,
  disabled,
}: {
  getValues: () => VoiceValues;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const test = useMutation({
    mutationFn: () => aiVoiceService.test(getValues()),
  });
  const res = test.data;
  const missing = res
    ? [
        ...(res.stt_model_installed ? [] : [res.stt_model]),
        ...(res.tts_model_installed ? [] : [res.tts_model]),
      ]
    : [];
  const reachable = res?.reachable ?? false;

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => test.mutate()}
          disabled={disabled || test.isPending}
        >
          {test.isPending ? t("common.loading") : t("ai.voice_test.button")}
        </Button>
        <p className="text-muted-foreground text-xs">
          {t("ai.voice_test.hint")}
        </p>
      </div>

      {res ? (
        <div className="space-y-2" role="status">
          {res.ok ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              {t("ai.voice_test.ok", { ms: res.latency_ms })}
            </p>
          ) : (
            <p className="text-destructive flex items-start gap-1.5 text-sm font-medium">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {missing.length > 0 && reachable
                  ? t("ai.voice_test.models_missing")
                  : t("ai.voice_test.failed", { message: res.message ?? "" })}
              </span>
            </p>
          )}
          {reachable ? (
            <>
              <ModelRow
                label={t("ai.voice_test.stt")}
                model={res.stt_model}
                installed={res.stt_model_installed}
              />
              <ModelRow
                label={t("ai.voice_test.tts")}
                model={`${res.tts_model} · ${res.tts_voice}`}
                installed={res.tts_model_installed}
              />
            </>
          ) : null}
          {reachable && missing.length > 0 ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                {t("ai.voice_test.download_hint")}
              </p>
              <pre className="bg-muted overflow-x-auto rounded-md p-2 text-[11px] leading-relaxed">
                {missing
                  .map(
                    (model) =>
                      `curl -X POST "${(res.base_url || "http://speaches:8000").replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/models/${model}"`,
                  )
                  .join("\n")}
              </pre>
            </div>
          ) : null}
          {test.isError ? (
            <p className="text-destructive text-xs">
              {t("ai.voice_test.request_failed")}
            </p>
          ) : null}
        </div>
      ) : test.isError ? (
        <p className="text-destructive text-xs">
          {t("ai.voice_test.request_failed")}
        </p>
      ) : null}
    </div>
  );
}
