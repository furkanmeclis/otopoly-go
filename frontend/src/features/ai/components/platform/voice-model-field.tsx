"use client";

import { Check, ChevronsUpDown, Download, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { FormFieldShell } from "@/components/forms/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useDownloadVoiceModel,
  useVoiceModels,
} from "@/features/ai/services/voice-models.service";
import type { AIVoiceModel } from "@/features/ai/types";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

type VoiceModelFieldProps = {
  name: "voice_stt_model" | "voice_tts_voice";
  kind: "stt" | "tts";
  label: string;
  description: string;
  placeholder: string;
  language: string;
  disabled?: boolean;
};

export function VoiceModelField({
  name,
  kind,
  label,
  description,
  placeholder,
  language,
  disabled,
}: VoiceModelFieldProps) {
  const { t } = useLocale();
  const { control, setValue, formState } = useFormContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const models = useVoiceModels(language || "tr");
  const download = useDownloadVoiceModel(language || "tr");
  const error = formState.errors[name]?.message as string | undefined;
  const task =
    kind === "stt" ? "automatic-speech-recognition" : "text-to-speech";

  // Installed models first, even when the registry does not list them.
  const options = useMemo(() => {
    const available = (models.data?.available ?? []).filter(
      (m) => m.task === task,
    );
    const known = new Set(available.map((m) => m.id));
    const installedOnly: AIVoiceModel[] = (models.data?.installed ?? [])
      .filter((m) => m.task === task && !known.has(m.id))
      .map((m) => ({ id: m.id, task, language: [], installed: true }));
    // Official repos (Systran whisper, speaches-ai piper) before community copies.
    const official = (id: string) =>
      id.startsWith("Systran/") || id.startsWith("speaches-ai/") ? 0 : 1;
    const ranked = [...available].sort(
      (a, b) =>
        Number(b.installed) - Number(a.installed) ||
        official(a.id) - official(b.id) ||
        a.id.localeCompare(b.id),
    );
    return [...installedOnly, ...ranked];
  }, [models.data?.available, models.data?.installed, task]);

  const selected = (value: string) =>
    options.find((m) => m.id === value) ??
    (value
      ? ({
          id: value,
          task,
          language: [],
          installed:
            models.data?.installed.some((m) => m.id === value) ?? false,
        } satisfies AIVoiceModel)
      : undefined);

  const customQuery = query.trim();
  const canUseCustom =
    customQuery !== "" && !options.some((m) => m.id === customQuery);

  const startDownload = (modelId: string) => {
    download.mutate(modelId, {
      onSuccess: (st) => {
        toast.success(
          st.state === "done"
            ? t("ai.voice_models.download_done")
            : t("ai.voice_models.download_started"),
        );
      },
      onError: (err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : t("ai.voice_models.download_error"),
        ),
    });
  };

  if (models.data && !models.data.reachable) {
    return (
      <FormFieldShell
        name={name}
        label={label}
        description={description}
        error={error}
      >
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <input
              {...field}
              value={field.value ?? ""}
              placeholder={placeholder}
              disabled={disabled}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          )}
        />
      </FormFieldShell>
    );
  }

  return (
    <FormFieldShell
      name={name}
      label={label}
      description={description}
      error={error}
    >
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const current = selected(field.value ?? "");
          const canDownload =
            current &&
            !current.installed &&
            current.download?.state !== "downloading";
          return (
            <div className="flex gap-2">
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={disabled || models.isLoading}
                    className={cn(
                      "h-9 min-w-0 flex-1 justify-between font-normal",
                      !field.value && "text-muted-foreground",
                    )}
                  >
                    <span className="truncate">
                      {field.value || placeholder}
                    </span>
                    <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                >
                  <Command>
                    <CommandInput
                      placeholder={t("ai.voice_models.search")}
                      value={query}
                      onValueChange={setQuery}
                    />
                    <CommandList>
                      <CommandEmpty>{t("ai.voice_models.empty")}</CommandEmpty>
                      {canUseCustom ? (
                        <CommandGroup>
                          <CommandItem
                            value={customQuery}
                            onSelect={() => {
                              field.onChange(customQuery);
                              setOpen(false);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {t("ai.voice_models.use_custom", {
                                model: customQuery,
                              })}
                            </span>
                          </CommandItem>
                        </CommandGroup>
                      ) : null}
                      <CommandGroup heading={t("ai.voice_models.installed")}>
                        {options
                          .filter((m) => m.installed)
                          .map((m) => (
                            <ModelItem
                              key={m.id}
                              model={m}
                              selected={field.value === m.id}
                              onSelect={() => {
                                field.onChange(m.id);
                                setOpen(false);
                              }}
                            />
                          ))}
                      </CommandGroup>
                      <CommandGroup heading={t("ai.voice_models.downloadable")}>
                        {options
                          .filter((m) => !m.installed)
                          .map((m) => (
                            <ModelItem
                              key={m.id}
                              model={m}
                              selected={field.value === m.id}
                              onSelect={() => {
                                field.onChange(m.id);
                                setOpen(false);
                              }}
                            />
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {canDownload ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || download.isPending}
                  onClick={() => startDownload(current.id)}
                >
                  {download.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {t("ai.voice_models.download")}
                </Button>
              ) : null}
              {current?.download?.state === "downloading" ? (
                <Badge variant="secondary" className="h-9 gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {t("ai.voice_models.downloading")}
                </Badge>
              ) : null}
              <input
                value={field.value ?? ""}
                onChange={(event) =>
                  setValue(name, event.target.value, { shouldDirty: true })
                }
                disabled={disabled}
                placeholder={placeholder}
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          );
        }}
      />
    </FormFieldShell>
  );
}

function ModelItem({
  model,
  selected,
  onSelect,
}: {
  model: AIVoiceModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useLocale();
  return (
    <CommandItem value={model.id} onSelect={onSelect}>
      <Check
        className={cn(
          "size-4 shrink-0",
          selected ? "text-primary opacity-100" : "opacity-0",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{model.id}</span>
      <VoiceModelBadge model={model} />
      {model.download?.state === "error" ? (
        <span className="sr-only">{t("ai.voice_models.error")}</span>
      ) : null}
    </CommandItem>
  );
}

export function VoiceModelBadge({ model }: { model: AIVoiceModel }) {
  const { t } = useLocale();
  if (model.download?.state === "downloading") {
    return (
      <Badge variant="secondary">{t("ai.voice_models.downloading")}</Badge>
    );
  }
  if (model.download?.state === "error") {
    return <Badge variant="danger">{t("ai.voice_models.error")}</Badge>;
  }
  if (model.installed) {
    return (
      <Badge variant="success">{t("ai.voice_models.installed_badge")}</Badge>
    );
  }
  return (
    <Badge variant="outline">{t("ai.voice_models.downloadable_badge")}</Badge>
  );
}

export function VoiceModelsAlert({
  sttModel,
  ttsModel,
  language,
}: {
  sttModel: string;
  ttsModel: string;
  language: string;
}) {
  const { t } = useLocale();
  const models = useVoiceModels(language || "tr");
  if (!models.data) return null;
  if (!models.data.reachable) {
    return (
      <Alert variant="destructive" className="sm:col-span-2">
        <AlertTitle>{t("ai.voice_models.unreachable_title")}</AlertTitle>
        <AlertDescription>
          {models.data.message || t("ai.voice_models.unreachable")}
        </AlertDescription>
      </Alert>
    );
  }
  const installed = new Set(models.data.installed.map((m) => m.id));
  const missing = [sttModel, ttsModel].filter((id) => id && !installed.has(id));
  if (missing.length === 0) return null;
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5 sm:col-span-2">
      <AlertTitle>{t("ai.voice_models.missing_title")}</AlertTitle>
      <AlertDescription>
        {t("ai.voice_models.missing", { models: missing.join(", ") })}
      </AlertDescription>
    </Alert>
  );
}
