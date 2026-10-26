"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Info,
  MessageCircle,
  Send,
  Smartphone,
  X,
} from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { EntityPage, EntitySectionCard } from "@/components/entity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AsyncCombobox,
  type ComboboxOption,
} from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { routes } from "@/config/routes";
import { FeatureLocked } from "@/features/billing";
import { customersService } from "@/features/customers/services/customers.service";
import {
  useReviewMutations,
  useReviewsAccess,
  useReviewSettings,
} from "@/features/reviews/hooks/use-reviews";
import {
  hourLabel,
  REVIEW_DELAY_OPTIONS,
  REVIEW_HOURS,
} from "@/features/reviews/lib/review-ui";
import type {
  ReviewChannelPreference,
  ReviewSettings,
  ReviewTestResult,
} from "@/features/reviews/types";
import { isFeatureDisabledError } from "@/lib/api/limit-events";
import { useLocale } from "@/providers/locale-provider";

export function ReviewSettingsPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const { canRead } = useReviewsAccess(slug);
  const query = useReviewSettings(canRead);
  const breadcrumbs = [
    { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
    { label: t("reviews.title"), href: routes.tenant.reviews.root(slug) },
    { label: t("reviews.settings.title") },
  ];
  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("reviews.forbidden")}
      />
    );
  }
  return (
    <EntityPage
      title={t("reviews.settings.title")}
      description={t("reviews.settings.description")}
      breadcrumbs={breadcrumbs}
    >
      {query.isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : isFeatureDisabledError(query.error) ? (
        <FeatureLocked slug={slug} />
      ) : query.isError || !query.data ? (
        <ErrorState
          title={t("reviews.errors.generic")}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <SettingsForm key={query.dataUpdatedAt} slug={slug} data={query.data} />
      )}
    </EntityPage>
  );
}

function SettingsForm({ slug, data }: { slug: string; data: ReviewSettings }) {
  const { t } = useLocale();
  const { canWrite } = useReviewsAccess(slug);
  const { saveSettings, sendTest } = useReviewMutations();
  const [enabled, setEnabled] = useState(data.enabled);
  const [channel, setChannel] = useState<ReviewChannelPreference>(data.channel);
  const [delay, setDelay] = useState(data.delay_minutes);
  const [quiet, setQuiet] = useState(data.quiet_hours_enabled);
  const [quietStart, setQuietStart] = useState(data.quiet_start_hour);
  const [quietEnd, setQuietEnd] = useState(data.quiet_end_hour);
  const [googleUrl, setGoogleUrl] = useState(data.google_review_url);
  const [threshold, setThreshold] = useState(data.high_score_threshold);
  const [minDays, setMinDays] = useState(String(data.min_days_between));
  const [locale, setLocale] = useState(data.default_locale);
  const [consent, setConsent] = useState(data.consent_text);
  const [excluded, setExcluded] = useState(data.excluded_customers);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<ReviewTestResult | null>(null);
  const disabled = !canWrite || saveSettings.isPending;

  const urlInvalid =
    googleUrl.trim() !== "" && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(googleUrl);
  const minDaysNum = Number(minDays);
  const minDaysInvalid =
    !Number.isInteger(minDaysNum) || minDaysNum < 0 || minDaysNum > 365;
  const delays = REVIEW_DELAY_OPTIONS.includes(delay)
    ? REVIEW_DELAY_OPTIONS
    : [...REVIEW_DELAY_OPTIONS, delay].sort((a, b) => a - b);

  const loadCustomers = useCallback(async (q: string) => {
    const result = await customersService.list({
      limit: 20,
      offset: 0,
      q: q.trim() || undefined,
    });
    return result.items.map((c): ComboboxOption => ({
      value: c.uuid,
      label: c.phone ? `${c.name} · ${c.phone}` : c.name,
    }));
  }, []);

  async function save() {
    await saveSettings.mutateAsync({
      enabled,
      channel,
      delay_minutes: delay,
      quiet_hours_enabled: quiet,
      quiet_start_hour: quietStart,
      quiet_end_hour: quietEnd,
      google_review_url: googleUrl.trim(),
      high_score_threshold: threshold,
      min_days_between: minDaysNum,
      default_locale: locale,
      consent_text: consent.trim(),
      excluded_customer_uuids: excluded.map((c) => c.uuid),
    });
  }

  async function test() {
    setTestResult(null);
    const res = await sendTest.mutateAsync(testPhone.trim() || undefined);
    setTestResult(res);
  }

  const channelReady =
    channel === "sms"
      ? data.sms_available
      : channel === "whatsapp"
        ? data.whatsapp_available
        : data.whatsapp_available || data.sms_available;
  const usagePct =
    data.usage.limit > 0
      ? Math.min(100, (data.usage.used / data.usage.limit) * 100)
      : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <EntitySectionCard title={t("reviews.settings.general")}>
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="reviews-enabled">
                  {t("reviews.settings.enabled")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("reviews.settings.enabled_hint")}
                </p>
              </div>
              <Switch
                id="reviews-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={disabled}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("reviews.settings.channel")}</Label>
                <Select
                  value={channel}
                  onValueChange={(v) =>
                    setChannel(v as ReviewChannelPreference)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["auto", "whatsapp", "sms"] as const).map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`reviews.settings.channel_option.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant={data.whatsapp_available ? "success" : "secondary"}
                  >
                    <MessageCircle className="size-3" />
                    {data.whatsapp_available
                      ? t("reviews.settings.whatsapp_ready")
                      : t("reviews.settings.whatsapp_off")}
                  </Badge>
                  <Badge variant={data.sms_available ? "success" : "secondary"}>
                    <Smartphone className="size-3" />
                    {data.sms_available
                      ? t("reviews.settings.sms_ready")
                      : t("reviews.settings.sms_off")}
                  </Badge>
                </div>
                {!channelReady ? (
                  <p className="text-destructive text-xs">
                    {t("reviews.settings.channel_missing")}{" "}
                    <Link
                      className="underline"
                      href={routes.tenant.settings.messaging(slug)}
                    >
                      {t("reviews.settings.open_messaging")}
                    </Link>
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>{t("reviews.settings.delay")}</Label>
                <Select
                  value={String(delay)}
                  onValueChange={(v) => setDelay(Number(v))}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {delays.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m < 60
                          ? t("reviews.settings.minutes", { count: m })
                          : t("reviews.settings.hours", { count: m / 60 })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {t("reviews.settings.delay_hint")}
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="reviews-quiet">
                    {t("reviews.settings.quiet_hours")}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {t("reviews.settings.quiet_hours_hint")}
                  </p>
                </div>
                <Switch
                  id="reviews-quiet"
                  checked={quiet}
                  onCheckedChange={setQuiet}
                  disabled={disabled}
                />
              </div>
              {quiet ? (
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ["quiet_start", quietStart, setQuietStart],
                      ["quiet_end", quietEnd, setQuietEnd],
                    ] as const
                  ).map(([key, value, set]) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs">
                        {t(`reviews.settings.${key}`)}
                      </Label>
                      <Select
                        value={String(value)}
                        onValueChange={(v) => set(Number(v))}
                        disabled={disabled}
                      >
                        <SelectTrigger className="w-full" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REVIEW_HOURS.map((h) => (
                            <SelectItem key={h} value={String(h)}>
                              {hourLabel(h)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("reviews.settings.threshold")}</Label>
                <Select
                  value={String(threshold)}
                  onValueChange={(v) => setThreshold(Number(v))}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t("reviews.settings.threshold_option", { count: n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reviews-min-days">
                  {t("reviews.settings.min_days")}
                </Label>
                <Input
                  id="reviews-min-days"
                  inputMode="numeric"
                  value={minDays}
                  onChange={(e) => setMinDays(e.target.value)}
                  aria-invalid={minDaysInvalid}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("reviews.settings.locale")}</Label>
                <Select
                  value={locale}
                  onValueChange={(v) => setLocale(v as "tr" | "en")}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tr">Türkçe</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-muted-foreground -mt-2 text-xs">
              {t("reviews.settings.threshold_hint")}
            </p>
          </div>
        </EntitySectionCard>

        <EntitySectionCard title={t("reviews.settings.google")}>
          <div className="space-y-3">
            <Input
              value={googleUrl}
              onChange={(e) => setGoogleUrl(e.target.value)}
              placeholder="https://g.page/r/…/review"
              aria-invalid={urlInvalid}
              disabled={disabled}
              inputMode="url"
            />
            {urlInvalid ? (
              <p className="text-destructive text-xs">
                {t("reviews.settings.google_invalid")}
              </p>
            ) : null}
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t("reviews.settings.google_help_title")}</AlertTitle>
              <AlertDescription>
                <ol className="list-decimal space-y-1 pl-4 text-xs">
                  <li>{t("reviews.settings.google_help_1")}</li>
                  <li>{t("reviews.settings.google_help_2")}</li>
                  <li>{t("reviews.settings.google_help_3")}</li>
                </ol>
              </AlertDescription>
            </Alert>
          </div>
        </EntitySectionCard>

        <EntitySectionCard title={t("reviews.settings.page")}>
          <div className="space-y-2">
            <Label htmlFor="reviews-consent">
              {t("reviews.settings.consent")}
            </Label>
            <Textarea
              id="reviews-consent"
              rows={2}
              maxLength={500}
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
              placeholder={t("reviews.settings.consent_placeholder")}
              disabled={disabled}
            />
            <p className="text-muted-foreground text-xs">
              {t("reviews.settings.consent_hint")}
            </p>
          </div>
        </EntitySectionCard>

        <EntitySectionCard
          title={t("reviews.settings.excluded")}
          badge={excluded.length || undefined}
        >
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {t("reviews.settings.excluded_hint")}
            </p>
            {canWrite ? (
              <AsyncCombobox
                value=""
                onValueChange={(uuid) => {
                  if (!uuid || excluded.some((c) => c.uuid === uuid)) return;
                  void customersService
                    .get(uuid)
                    .then((c) =>
                      setExcluded((prev) =>
                        prev.some((x) => x.uuid === c.uuid)
                          ? prev
                          : [
                              ...prev,
                              { uuid: c.uuid, name: c.name, phone: c.phone },
                            ],
                      ),
                    );
                }}
                loadOptions={loadCustomers}
                selectedValues={excluded.map((c) => c.uuid)}
                hideSelected
                placeholder={t("reviews.settings.excluded_add")}
                searchPlaceholder={t("reviews.settings.excluded_search")}
                emptyText={t("reviews.settings.excluded_none_found")}
              />
            ) : null}
            {excluded.length ? (
              <div className="flex flex-wrap gap-1.5">
                {excluded.map((c) => (
                  <Badge key={c.uuid} variant="secondary" className="gap-1">
                    {c.name}
                    {canWrite ? (
                      <button
                        type="button"
                        aria-label={t("reviews.settings.excluded_remove", {
                          name: c.name,
                        })}
                        className="hover:text-destructive"
                        onClick={() =>
                          setExcluded((prev) =>
                            prev.filter((x) => x.uuid !== c.uuid),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("reviews.settings.excluded_empty")}
              </p>
            )}
          </div>
        </EntitySectionCard>

        {canWrite ? (
          <div className="flex justify-end">
            <Button
              onClick={() => void save()}
              disabled={disabled || urlInvalid || minDaysInvalid}
            >
              {t("common.save")}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("reviews.settings.read_only")}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <EntitySectionCard
          title={t("reviews.settings.template")}
          action={
            <Link
              href={routes.tenant.settings.messaging(slug)}
              className="text-primary text-xs underline-offset-4 hover:underline"
            >
              {t("reviews.settings.template_edit")}
            </Link>
          }
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">
                {t(`reviews.channel.${data.template.channel}`)}
              </Badge>
              <Badge variant="outline">
                {data.template.is_custom
                  ? t("reviews.settings.template_custom")
                  : t("reviews.settings.template_default")}
              </Badge>
              {!data.template.active ? (
                <Badge variant="danger">
                  {t("reviews.settings.template_inactive")}
                </Badge>
              ) : null}
            </div>
            <div className="bg-muted/50 rounded-lg border p-3 text-sm whitespace-pre-wrap">
              {data.template.preview}
            </div>
            <p className="text-muted-foreground text-xs">
              {t("reviews.settings.template_vars")}
            </p>
          </div>
        </EntitySectionCard>

        <EntitySectionCard title={t("reviews.settings.usage")}>
          <div className="space-y-2 text-sm">
            <p className="tabular-nums">
              {data.usage.limit < 0
                ? t("reviews.settings.usage_unlimited", {
                    used: data.usage.used,
                  })
                : t("reviews.settings.usage_value", {
                    used: data.usage.used,
                    limit: data.usage.limit,
                  })}
            </p>
            {usagePct !== undefined ? <Progress value={usagePct} /> : null}
          </div>
        </EntitySectionCard>

        {canWrite ? (
          <EntitySectionCard title={t("reviews.settings.test")}>
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">
                {t("reviews.settings.test_hint")}
              </p>
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder={t("reviews.settings.test_phone")}
                inputMode="tel"
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void test()}
                disabled={sendTest.isPending || !channelReady}
              >
                <Send className="size-4" />
                {t("reviews.settings.test_send")}
              </Button>
              {testResult ? (
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertTitle>
                    {t("reviews.settings.test_sent", {
                      phone: testResult.phone,
                      channel: t(`reviews.channel.${testResult.channel}`),
                    })}
                  </AlertTitle>
                  <AlertDescription>
                    <a
                      href={testResult.public_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary break-all underline"
                    >
                      {testResult.public_url}
                    </a>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          </EntitySectionCard>
        ) : null}
      </div>
    </div>
  );
}
