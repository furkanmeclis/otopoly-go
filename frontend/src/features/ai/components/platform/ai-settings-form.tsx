"use client";

import {
  AudioLines,
  Cpu,
  Gauge,
  KeyRound,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  AppForm,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea,
  FormActions,
  FormLayout,
  FormSection,
  createFormSections,
} from "@/components/forms";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { VoiceTestPanel } from "@/features/ai/components/platform/voice-test-panel";
import { toolLabelKey } from "@/features/ai/lib/labels";
import {
  aiSettingsFormSchema,
  type AISettingsFormValues,
} from "@/features/ai/schemas/ai-settings-form";
import type { AISettings } from "@/features/ai/types";
import { useLocale } from "@/providers/locale-provider";

type AISettingsFormProps = {
  settings: AISettings;
  canWrite: boolean;
  isSaving: boolean;
  isTesting: boolean;
  onSubmit: (values: AISettingsFormValues) => Promise<void>;
  onTest: () => void;
};

function permissionLabelKey(slug: string) {
  return `permissions.labels.${slug}`;
}

export function toFormValues(settings: AISettings): AISettingsFormValues {
  return {
    provider: settings.provider,
    api_key: "",
    clear_api_key: false,
    base_url: settings.base_url,
    model: settings.model,
    title_model: settings.title_model,
    effort: settings.effort,
    max_tokens: settings.max_tokens,
    feature_chat: settings.features.chat,
    feature_charts: settings.features.charts,
    feature_actions: settings.features.actions,
    feature_todos: settings.features.todos,
    feature_voice: settings.features.voice,
    tools: Object.fromEntries(settings.tools.map((t) => [t.name, t.enabled])),
    extra_instructions: settings.extra_instructions,
    default_monthly_token_quota: settings.default_monthly_token_quota,
    voice_base_url: settings.voice.base_url,
    voice_stt_model: settings.voice.stt_model,
    voice_tts_voice: settings.voice.tts_voice,
    voice_language: settings.voice.language,
  };
}

export function AISettingsForm({
  settings,
  canWrite,
  isSaving,
  isTesting,
  onSubmit,
  onTest,
}: AISettingsFormProps) {
  const { t } = useLocale();
  const [formKey, setFormKey] = useState(0);
  const defaultValues = useMemo(() => toFormValues(settings), [settings]);
  const disabled = !canWrite || isSaving;

  const sections = useMemo(
    () =>
      createFormSections([
        { key: "provider", label: t("ai.form.section_provider"), icon: Cpu },
        {
          key: "features",
          label: t("ai.form.section_features"),
          icon: Sparkles,
        },
        { key: "tools", label: t("ai.form.section_tools"), icon: Wrench },
        {
          key: "instructions",
          label: t("ai.form.section_instructions"),
          icon: ScrollText,
        },
        { key: "quota", label: t("ai.form.section_quota"), icon: Gauge },
        { key: "voice", label: t("ai.form.section_voice"), icon: AudioLines },
      ]),
    [t],
  );

  return (
    <AppForm
      key={formKey}
      schema={aiSettingsFormSchema}
      defaultValues={defaultValues}
      onSubmit={async (values) => {
        await onSubmit(values);
        setFormKey((k) => k + 1);
      }}
    >
      {(form) => {
        const provider = form.watch("provider");
        const clearKey = form.watch("clear_api_key");
        const isOpenAI = provider === "openai_compatible";
        const soon = (
          <Badge variant="secondary" className="ml-2 align-middle">
            {t("ai.form.soon")}
          </Badge>
        );
        return (
          <FormLayout navItems={sections.navItems}>
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <ShieldAlert className="size-4 text-amber-600" />
              <AlertTitle>{t("ai.kvkk.title")}</AlertTitle>
              <AlertDescription>
                {isOpenAI
                  ? t("ai.kvkk.local")
                  : t("ai.kvkk.cloud", { provider: "Anthropic" })}
              </AlertDescription>
            </Alert>

            <FormSection
              id={sections.id("provider")}
              title={t("ai.form.section_provider")}
              description={t("ai.form.section_provider_hint")}
              columns={2}
            >
              <AppSelect
                name="provider"
                label={t("ai.form.provider")}
                disabled={disabled}
                options={[
                  {
                    value: "anthropic",
                    label: t("ai.form.provider_anthropic"),
                  },
                  {
                    value: "openai_compatible",
                    label: t("ai.form.provider_openai"),
                  },
                ]}
              />
              <AppInput
                name="base_url"
                label={t("ai.form.base_url")}
                description={
                  isOpenAI
                    ? t("ai.form.base_url_hint_openai")
                    : t("ai.form.base_url_hint_anthropic")
                }
                placeholder={
                  isOpenAI
                    ? "http://ollama:11434/v1"
                    : "https://api.anthropic.com"
                }
                disabled={disabled}
              />

              <div className="space-y-2 sm:col-span-2">
                <AppInput
                  name="api_key"
                  type="password"
                  autoComplete="off"
                  startIcon={KeyRound}
                  label={t("ai.form.api_key")}
                  description={
                    isOpenAI
                      ? t("ai.form.api_key_optional_hint")
                      : t("ai.form.api_key_hint")
                  }
                  placeholder={
                    settings.has_api_key && !clearKey
                      ? t("ai.form.api_key_placeholder_replace")
                      : t("ai.form.api_key_placeholder_new")
                  }
                  disabled={disabled || clearKey}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {clearKey ? (
                    <>
                      <Badge variant="danger">
                        {t("ai.form.api_key_clear_pending")}
                      </Badge>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() =>
                          form.setValue("clear_api_key", false, {
                            shouldDirty: true,
                          })
                        }
                      >
                        {t("ai.form.api_key_clear_undo")}
                      </Button>
                    </>
                  ) : settings.has_api_key ? (
                    <>
                      <Badge variant="success">
                        {settings.api_key_hint
                          ? t("ai.form.api_key_saved", {
                              hint: settings.api_key_hint,
                            })
                          : t("ai.form.api_key_saved_nohint")}
                      </Badge>
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="text-destructive h-auto p-0 text-xs"
                          onClick={() => {
                            form.setValue("api_key", "");
                            form.setValue("clear_api_key", true, {
                              shouldDirty: true,
                            });
                          }}
                        >
                          {t("ai.form.api_key_clear")}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Badge variant="outline">
                      {t("ai.form.api_key_missing")}
                    </Badge>
                  )}
                </div>
              </div>

              <AppInput
                name="model"
                label={t("ai.form.model")}
                description={t("ai.form.model_hint")}
                placeholder="claude-opus-5"
                disabled={disabled}
              />
              <AppInput
                name="title_model"
                label={t("ai.form.title_model")}
                description={t("ai.form.title_model_hint")}
                placeholder="claude-haiku-4-5"
                disabled={disabled || isOpenAI}
              />
              <AppSelect
                name="effort"
                label={t("ai.form.effort")}
                description={t("ai.form.effort_hint")}
                disabled={disabled}
                options={[
                  { value: "low", label: t("ai.form.effort_low") },
                  { value: "medium", label: t("ai.form.effort_medium") },
                  { value: "high", label: t("ai.form.effort_high") },
                  { value: "xhigh", label: t("ai.form.effort_xhigh") },
                  { value: "max", label: t("ai.form.effort_max") },
                ]}
              />
              <AppInput
                name="max_tokens"
                type="number"
                min={256}
                max={128000}
                step={256}
                label={t("ai.form.max_tokens")}
                description={t("ai.form.max_tokens_hint")}
                disabled={disabled}
              />
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onTest}
                  disabled={!canWrite || isTesting || form.formState.isDirty}
                >
                  {isTesting ? t("common.loading") : t("ai.form.test")}
                </Button>
                <p className="text-muted-foreground text-xs">
                  {t("ai.form.test_hint")}
                </p>
              </div>
            </FormSection>

            <FormSection
              id={sections.id("features")}
              title={t("ai.form.section_features")}
              description={t("ai.form.section_features_hint")}
            >
              <AppSwitch
                name="feature_chat"
                label={t("ai.form.feature_chat")}
                description={t("ai.form.feature_chat_hint")}
                disabled={disabled}
              />
              <AppSwitch
                name="feature_charts"
                label={t("ai.form.feature_charts")}
                description={t("ai.form.feature_charts_hint")}
                disabled={disabled}
              />
              <AppSwitch
                name="feature_actions"
                label={t("ai.form.feature_actions")}
                description={t("ai.form.feature_actions_hint")}
                disabled={disabled}
              />
              <AppSwitch
                name="feature_todos"
                label={t("ai.form.feature_todos")}
                description={t("ai.form.feature_todos_hint")}
                disabled={disabled}
              />
              {(
                [
                  [
                    "feature_voice",
                    "ai.form.feature_voice",
                    "ai.form.feature_voice_hint",
                  ],
                ] as const
              ).map(([name, label, hint]) => (
                <div
                  key={name}
                  className="flex items-start justify-between gap-4"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={name}>
                      {t(label)}
                      {name === "feature_voice" ? null : soon}
                    </Label>
                    <p className="text-muted-foreground text-xs">{t(hint)}</p>
                  </div>
                  <Switch
                    id={name}
                    checked={form.watch(name)}
                    onCheckedChange={(v) =>
                      form.setValue(name, v, { shouldDirty: true })
                    }
                    disabled={disabled}
                  />
                </div>
              ))}
            </FormSection>

            <FormSection
              id={sections.id("tools")}
              title={t("ai.form.section_tools")}
              description={t("ai.form.section_tools_hint")}
            >
              <div className="divide-border divide-y rounded-lg border">
                {settings.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">
                        {t(toolLabelKey(tool.name))}
                        <code className="text-muted-foreground ml-2 text-xs font-normal">
                          {tool.name}
                        </code>
                      </p>
                      <div className="text-muted-foreground text-xs">
                        {tool.requires_confirmation ? (
                          <Badge
                            variant="outline"
                            className="mr-1.5 px-1.5 py-0 text-[10px] font-normal"
                          >
                            {t("ai.form.tool_confirm_badge")}
                          </Badge>
                        ) : null}
                        {tool.permissions.length > 0
                          ? t("ai.form.tool_requires", {
                              permissions: tool.permissions
                                .map((p) => t(permissionLabelKey(p)))
                                .join(", "),
                            })
                          : t("ai.form.tool_no_permission")}
                      </div>
                    </div>
                    <Switch
                      checked={form.watch(`tools.${tool.name}`) ?? true}
                      onCheckedChange={(v) =>
                        form.setValue(`tools.${tool.name}`, v, {
                          shouldDirty: true,
                        })
                      }
                      disabled={disabled}
                      aria-label={tool.name}
                    />
                  </div>
                ))}
              </div>
            </FormSection>

            <FormSection
              id={sections.id("instructions")}
              title={t("ai.form.section_instructions")}
              description={t("ai.form.section_instructions_hint")}
            >
              <AppTextarea
                name="extra_instructions"
                label={t("ai.form.extra_instructions")}
                placeholder={t("ai.form.extra_instructions_placeholder")}
                rows={5}
                disabled={disabled}
              />
            </FormSection>

            <FormSection
              id={sections.id("quota")}
              title={t("ai.form.section_quota")}
              description={t("ai.form.section_quota_hint")}
              columns={2}
            >
              <AppInput
                name="default_monthly_token_quota"
                type="number"
                min={0}
                step={100000}
                label={t("ai.form.default_quota")}
                disabled={disabled}
              />
            </FormSection>

            <FormSection
              id={sections.id("voice")}
              title={t("ai.form.section_voice")}
              description={t("ai.form.section_voice_hint")}
              columns={2}
            >
              <AppInput
                name="voice_base_url"
                label={t("ai.form.voice_base_url")}
                description={t("ai.form.voice_base_url_hint")}
                placeholder="http://app-speaches:8000"
                disabled={disabled}
              />
              <AppInput
                name="voice_language"
                label={t("ai.form.voice_language")}
                description={t("ai.form.voice_language_hint")}
                placeholder="tr"
                disabled={disabled}
              />
              <AppInput
                name="voice_stt_model"
                label={t("ai.form.voice_stt_model")}
                description={t("ai.form.voice_stt_model_hint")}
                placeholder="Systran/faster-whisper-small"
                disabled={disabled}
              />
              <AppInput
                name="voice_tts_voice"
                label={t("ai.form.voice_tts_voice")}
                description={t("ai.form.voice_tts_voice_hint")}
                placeholder="speaches-ai/piper-tr_TR-fettah-medium"
                disabled={disabled}
              />
              <VoiceTestPanel
                disabled={!canWrite}
                getValues={() => ({
                  base_url: form.getValues("voice_base_url") ?? "",
                  stt_model: form.getValues("voice_stt_model") ?? "",
                  tts_voice: form.getValues("voice_tts_voice") ?? "",
                })}
              />
            </FormSection>

            {canWrite ? (
              <FormActions>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => form.reset(defaultValues)}
                  disabled={isSaving}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? t("common.loading") : t("ai.form.save")}
                </Button>
              </FormActions>
            ) : null}
          </FormLayout>
        );
      }}
    </AppForm>
  );
}
