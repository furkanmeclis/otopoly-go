/** Review settings — web `/t/[slug]/reviews/settings` (`review-settings-page.tsx`). Edits are owner only like the backend. */
import { router } from 'expo-router';
import { CheckCircle2, Info, Send } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { isFeatureDisabled } from '@/api/errors';
import { Badge, Button, Card, ErrorState, Field, Header, ListSkeleton, Row, Screen, Section, Segmented, SelectField, SwitchRow, TextField, Txt } from '@/components/ui';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import { hourLabel, isValidGoogleUrl, REVIEW_DELAY_OPTIONS } from '@/features/reviews/lib/review-ui';
import { useReviewMutations, useReviewsAccess, useReviewSettings } from '@/features/reviews/queries';
import type { ReviewChannelPreference, ReviewSettings, ReviewTestResult } from '@/features/reviews/types';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function ReviewSettingsScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.reviewsRead} title={tr('reviews.settings.title')}>
      <Settings />
    </RequirePermission>
  );
}

function Settings() {
  const { t: tr } = useLocale();
  const query = useReviewSettings();
  if (query.isLoading)
    return (
      <Screen header={<Header title={tr('reviews.settings.title')} />}>
        <ListSkeleton rows={6} height={56} />
      </Screen>
    );
  if (query.isError || !query.data)
    return (
      <Screen header={<Header title={tr('reviews.settings.title')} />}>
        {isFeatureDisabled(query.error) ? <FeatureLockedState feature="reviews.enabled" /> : <ErrorState error={query.error} description={tr('reviews.errors.generic')} onRetry={() => void query.refetch()} />}
      </Screen>
    );
  // Remount with the saved values whenever they change.
  return <SettingsForm key={query.dataUpdatedAt} data={query.data} refetch={() => void query.refetch()} refreshing={query.isRefetching} />;
}

type Values = {
  enabled: boolean;
  channel: ReviewChannelPreference;
  delay_minutes: number;
  quiet_hours_enabled: boolean;
  quiet_start_hour: number;
  quiet_end_hour: number;
  google_review_url: string;
  high_score_threshold: number;
  min_days_between: string;
  default_locale: 'tr' | 'en';
  consent_text: string;
};

const toValues = (s: ReviewSettings): Values => ({
  enabled: s.enabled,
  channel: s.channel,
  delay_minutes: s.delay_minutes,
  quiet_hours_enabled: s.quiet_hours_enabled,
  quiet_start_hour: s.quiet_start_hour,
  quiet_end_hour: s.quiet_end_hour,
  google_review_url: s.google_review_url,
  high_score_threshold: s.high_score_threshold,
  min_days_between: String(s.min_days_between),
  default_locale: s.default_locale,
  consent_text: s.consent_text,
});

function SettingsForm({ data, refetch, refreshing }: { data: ReviewSettings; refetch: () => void; refreshing: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { canWrite } = useReviewsAccess();
  const { saveSettings, sendTest } = useReviewMutations();
  const initial = toValues(data);
  const [v, setV] = useState<Values>(initial);
  const [phone, setPhone] = useState('');
  const [testResult, setTestResult] = useState<ReviewTestResult | null>(null);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const errs = fieldErrors(saveSettings.error);
  const minDays = Number(v.min_days_between);
  const minDaysInvalid = !Number.isInteger(minDays) || minDays < 0 || minDays > 365;
  const urlInvalid = !isValidGoogleUrl(v.google_review_url);
  const disabled = !canWrite;
  const channelReady = v.channel === 'sms' ? data.sms_available : v.channel === 'whatsapp' ? data.whatsapp_available : data.whatsapp_available || data.sms_available;
  const delays = REVIEW_DELAY_OPTIONS.includes(v.delay_minutes) ? REVIEW_DELAY_OPTIONS : [...REVIEW_DELAY_OPTIONS, v.delay_minutes].sort((a, b) => a - b);
  const delayLabel = (m: number) => (m < 60 ? tr('reviews.settings.minutes', { count: m }) : tr('reviews.settings.hours', { count: m / 60 }));

  const submit = () => {
    if (urlInvalid || minDaysInvalid) return;
    saveSettings.mutate({ ...v, google_review_url: v.google_review_url.trim(), consent_text: v.consent_text.trim(), min_days_between: minDays });
  };

  return (
    <Screen
      header={<Header title={tr('reviews.settings.title')} subtitle={tr('reviews.settings.description')} />}
      refreshing={refreshing}
      onRefresh={refetch}
      footer={
        canWrite ? (
          <Row gap={t.spacing.sm}>
            <View style={{ flex: 1 }}>
              <Button variant="outline" label={tr('common.cancel')} disabled={!dirty || saveSettings.isPending} onPress={() => setV(initial)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button label={tr('common.save')} loading={saveSettings.isPending} disabled={!dirty || urlInvalid || minDaysInvalid} onPress={submit} />
            </View>
          </Row>
        ) : undefined
      }
    >
      {!canWrite ? (
        <Txt variant="caption" tone="muted">
          {tr('reviews.settings.read_only')}
        </Txt>
      ) : null}

      <Section title={tr('reviews.settings.general')}>
        <Card style={{ gap: t.spacing.md }}>
          <SwitchRow label={tr('reviews.settings.enabled')} description={tr('reviews.settings.enabled_hint')} value={v.enabled} onValueChange={(x) => set('enabled', x)} disabled={disabled} />
          <SelectField
            label={tr('reviews.settings.channel')}
            value={v.channel}
            disabled={disabled}
            options={(['auto', 'whatsapp', 'sms'] as const).map((c) => ({ value: c, label: tr(`reviews.settings.channel_option.${c}`) }))}
            onChange={(x) => x && set('channel', x as ReviewChannelPreference)}
          />
          <Row gap={6} wrap>
            <Badge size="sm" tone={data.whatsapp_available ? 'success' : 'neutral'} label={data.whatsapp_available ? tr('reviews.settings.whatsapp_ready') : tr('reviews.settings.whatsapp_off')} />
            <Badge size="sm" tone={data.sms_available ? 'success' : 'neutral'} label={data.sms_available ? tr('reviews.settings.sms_ready') : tr('reviews.settings.sms_off')} />
          </Row>
          {!channelReady ? (
            <Row gap={t.spacing.sm} wrap>
              <Txt variant="caption" tone="danger">
                {tr('reviews.settings.channel_missing')}
              </Txt>
              <Button size="sm" variant="ghost" label={tr('reviews.settings.open_messaging')} onPress={() => router.push('/settings/messaging')} />
            </Row>
          ) : null}
          <SelectField
            label={tr('reviews.settings.delay')}
            value={String(v.delay_minutes)}
            disabled={disabled}
            options={delays.map((m) => ({ value: String(m), label: delayLabel(m) }))}
            onChange={(x) => x && set('delay_minutes', Number(x))}
          />
          <Txt variant="caption" tone="muted">
            {tr('reviews.settings.delay_hint')}
          </Txt>
        </Card>
      </Section>

      <Section title={tr('reviews.settings.quiet_hours')}>
        <Card style={{ gap: t.spacing.md }}>
          <SwitchRow label={tr('reviews.settings.quiet_hours')} description={tr('reviews.settings.quiet_hours_hint')} value={v.quiet_hours_enabled} onValueChange={(x) => set('quiet_hours_enabled', x)} disabled={disabled} />
          {v.quiet_hours_enabled ? (
            <Row gap={t.spacing.sm}>
              <View style={{ flex: 1 }}>
                <SelectField label={tr('reviews.settings.quiet_start')} value={String(v.quiet_start_hour)} disabled={disabled} options={HOURS.map((h) => ({ value: String(h), label: hourLabel(h) }))} onChange={(x) => x && set('quiet_start_hour', Number(x))} />
              </View>
              <View style={{ flex: 1 }}>
                <SelectField label={tr('reviews.settings.quiet_end')} value={String(v.quiet_end_hour)} disabled={disabled} options={HOURS.map((h) => ({ value: String(h), label: hourLabel(h) }))} onChange={(x) => x && set('quiet_end_hour', Number(x))} />
              </View>
            </Row>
          ) : null}
        </Card>
      </Section>

      <Section title={tr('reviews.settings.google')}>
        <Card style={{ gap: t.spacing.md }}>
          <TextField
            label={tr('reviews.settings.google')}
            value={v.google_review_url}
            onChangeText={(x) => set('google_review_url', x)}
            placeholder="https://g.page/r/…/review"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!disabled}
            error={urlInvalid ? tr('reviews.settings.google_invalid') : errs.google_review_url}
          />
          <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
            <Info size={16} color={t.colors.info} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="label">{tr('reviews.settings.google_help_title')}</Txt>
              <Txt variant="caption" tone="secondary">
                1. {tr('reviews.settings.google_help_1')}
              </Txt>
              <Txt variant="caption" tone="secondary">
                2. {tr('reviews.settings.google_help_2')}
              </Txt>
              <Txt variant="caption" tone="secondary">
                3. {tr('reviews.settings.google_help_3')}
              </Txt>
            </View>
          </Row>
        </Card>
      </Section>

      <Section title={tr('reviews.settings.page')}>
        <Card style={{ gap: t.spacing.md }}>
          <SelectField
            label={tr('reviews.settings.threshold')}
            value={String(v.high_score_threshold)}
            disabled={disabled}
            options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: tr('reviews.settings.threshold_option', { count: n }) }))}
            onChange={(x) => x && set('high_score_threshold', Number(x))}
          />
          <Txt variant="caption" tone="muted">
            {tr('reviews.settings.threshold_hint')}
          </Txt>
          <TextField
            label={tr('reviews.settings.min_days')}
            value={v.min_days_between}
            onChangeText={(x) => set('min_days_between', x.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            editable={!disabled}
            error={minDaysInvalid ? tr('reviews.errors.VALIDATION_ERROR') : errs.min_days_between}
          />
          <Field label={tr('reviews.settings.locale')}>
            <Segmented<'tr' | 'en'>
              value={v.default_locale}
              onChange={(x) => !disabled && set('default_locale', x)}
              options={[
                { value: 'tr', label: tr('mobile.language.tr') },
                { value: 'en', label: tr('mobile.language.en') },
              ]}
            />
          </Field>
          <TextField
            label={tr('reviews.settings.consent')}
            value={v.consent_text}
            onChangeText={(x) => set('consent_text', x)}
            placeholder={tr('reviews.settings.consent_placeholder')}
            hint={tr('reviews.settings.consent_hint')}
            multiline
            maxLength={500}
            editable={!disabled}
          />
          {data.excluded_customers.length ? (
            <View style={{ gap: 6 }}>
              <Txt variant="label">{tr('reviews.settings.excluded')}</Txt>
              <Row gap={6} wrap>
                {data.excluded_customers.map((c) => (
                  <Badge key={c.uuid} size="sm" label={c.name} />
                ))}
              </Row>
              <Txt variant="caption" tone="muted">
                {tr('mobile.reviews.excluded_on_web')}
              </Txt>
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title={tr('reviews.settings.template')}>
        <Card style={{ gap: t.spacing.sm }}>
          <Row gap={6} wrap>
            <Badge size="sm" label={tr(`reviews.channel.${data.template.channel}`)} />
            <Badge size="sm" tone="info" label={data.template.is_custom ? tr('reviews.settings.template_custom') : tr('reviews.settings.template_default')} />
            {!data.template.active ? <Badge size="sm" tone="danger" label={tr('reviews.settings.template_inactive')} /> : null}
          </Row>
          <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md, padding: t.spacing.md }}>
            <Txt>{data.template.preview}</Txt>
          </View>
          <Txt variant="caption" tone="muted">
            {tr('reviews.settings.template_vars')}
          </Txt>
        </Card>
      </Section>

      <Section title={tr('reviews.settings.usage')}>
        <Card>
          <Txt style={{ fontVariant: ['tabular-nums'] }}>
            {data.usage.limit < 0 ? tr('reviews.settings.usage_unlimited', { used: data.usage.used }) : tr('reviews.settings.usage_value', { used: data.usage.used, limit: data.usage.limit })}
          </Txt>
        </Card>
      </Section>

      {canWrite ? (
        <Section title={tr('reviews.settings.test')}>
          <Card style={{ gap: t.spacing.md }}>
            <Txt variant="caption" tone="secondary">
              {tr('reviews.settings.test_hint')}
            </Txt>
            <TextField label={tr('reviews.settings.test_phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Button
              variant="outline"
              label={tr('reviews.settings.test_send')}
              icon={<Send size={16} color={t.colors.text} />}
              loading={sendTest.isPending}
              disabled={!channelReady}
              onPress={() => {
                setTestResult(null);
                sendTest.mutate(phone.trim() || undefined, { onSuccess: setTestResult });
              }}
            />
            {testResult ? (
              <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
                <CheckCircle2 size={18} color={t.colors.success} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt tone="success">{tr('reviews.settings.test_sent', { phone: testResult.phone, channel: tr(`reviews.channel.${testResult.channel}`) })}</Txt>
                  <Button size="sm" variant="ghost" label={tr('mobile.reviews.open_test')} onPress={() => router.push(`/reviews/${testResult.review.uuid}`)} />
                </View>
              </Row>
            ) : null}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
