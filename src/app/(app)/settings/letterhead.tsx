import { useQueryClient } from '@tanstack/react-query';
import { Contact, Image as ImageIcon, Palette } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { apiUrl } from '@/api/files';
import { Button, Card, ErrorState, Header, ListSkeleton, Row, Screen, Section, Segmented, TextField, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { BRAND_PRIMARY, exportSettingsKey, exportSettingsService, normalizeHexColor, PAPER_SIZES, useExportSettings, type PaperSize } from '@/features/export-settings/service';
import type { AppSettings } from '@/features/io/types';
import { useLocale } from '@/lib/i18n/provider';
import { fieldErrors, useApiMutation } from '@/lib/mutation';
import { useTheme } from '@/theme/provider';

/** Quick picks for the letterhead colour (the web uses a native colour input). */
const SWATCHES = ['#EA6E43', '#DC2626', '#D97706', '#16A34A', '#0891B2', '#2563EB', '#7C3AED', '#1A1412'];

/** Web tenant `settings` page (SettingsPage scope=tenant): export settings / letterhead. Owner-only like the backend. */
export default function LetterheadScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={{ perm: P.settingsRead, owner: true }} title={tr('settings.title')}>
      <Letterhead />
    </RequirePermission>
  );
}

function Letterhead() {
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const query = useExportSettings(true);
  const canWrite = can({ perm: P.settingsWrite, owner: true });
  if (query.isLoading)
    return (
      <Screen header={<Header title={tr('settings.title')} />}>
        <ListSkeleton rows={6} height={56} />
      </Screen>
    );
  if (query.isError || !query.data)
    return (
      <Screen header={<Header title={tr('settings.title')} />}>
        <ErrorState description={tr('settings.forbidden')} onRetry={() => void query.refetch()} />
      </Screen>
    );
  // Remount with fresh values whenever the saved settings change (web keys the form by the JSON).
  return <LetterheadForm key={JSON.stringify(query.data)} settings={query.data} canWrite={canWrite} refetch={() => void query.refetch()} refreshing={query.isRefetching} />;
}

type Values = { company_name: string; tagline: string; primary_color: string; paper_size: PaperSize; address: string; city: string; district: string; phone: string; email: string; website: string; footer_text: string };

function toValues(s: AppSettings): Values {
  return {
    company_name: s.company_name,
    tagline: s.tagline,
    primary_color: normalizeHexColor(s.primary_color, BRAND_PRIMARY),
    paper_size: (PAPER_SIZES as readonly string[]).includes(s.paper_size) ? (s.paper_size as PaperSize) : 'A4',
    address: s.address,
    city: s.city ?? '',
    district: s.district ?? '',
    phone: s.phone,
    email: s.email,
    website: s.website,
    footer_text: s.footer_text,
  };
}

function LetterheadForm({ settings, canWrite, refetch, refreshing }: { settings: AppSettings; canWrite: boolean; refetch: () => void; refreshing: boolean }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const initial = toValues(settings);
  const [v, setV] = useState<Values>(initial);
  const [colorText, setColorText] = useState(initial.primary_color);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const save = useApiMutation({
    key: 'settings.export.save',
    fn: (body: Values) => exportSettingsService.patch(body),
    success: tr('settings.toast.saved'),
    onSuccess: (data) => qc.setQueryData(exportSettingsKey, data),
  });
  const removeLogo = useApiMutation({
    key: 'settings.export.logo_remove',
    fn: () => exportSettingsService.deleteLogo(),
    success: tr('settings.toast.logo_removed'),
    onSuccess: (data) => qc.setQueryData(exportSettingsKey, data),
  });
  const errs = { ...fieldErrors(save.error), ...localErrors };

  const submit = () => {
    const e: Record<string, string> = {};
    const trimmed = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x.trim() : x])) as Values;
    if (!trimmed.company_name) e.company_name = tr('form.required');
    if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed.primary_color)) e.primary_color = tr('mobile.settings.invalid_color');
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(trimmed);
  };

  const commitColor = (text: string) => {
    const next = normalizeHexColor(text, '');
    if (next) set('primary_color', next.toUpperCase());
    else setColorText(v.primary_color); // same as web onBlur: invalid input falls back
  };

  const logoSrc = settings.logo_url ? apiUrl(settings.logo_url) : null;

  return (
    <Screen
      header={<Header title={tr('settings.title')} subtitle={tr('settings.tenant_description')} />}
      refreshing={refreshing}
      onRefresh={refetch}
      footer={
        canWrite ? (
          <Row gap={t.spacing.sm}>
            <View style={{ flex: 1 }}>
              <Button
                variant="outline"
                label={tr('common.cancel')}
                disabled={!dirty || save.isPending}
                onPress={() => {
                  setV(initial);
                  setColorText(initial.primary_color);
                  setLocalErrors({});
                }}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Button label={save.isPending ? tr('common.loading') : tr('settings.save')} loading={save.isPending} disabled={!dirty} onPress={submit} />
            </View>
          </Row>
        ) : undefined
      }
    >
      <Section title={tr('settings.form.section_branding')}>
        <Row gap={t.spacing.sm}>
          <Palette size={16} color={t.colors.textSecondary} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
            {tr('settings.branding_hint')}
          </Txt>
        </Row>
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
          {tr('settings.preview_strip')}
        </Txt>
        <Card style={{ borderTopWidth: 4, borderTopColor: v.primary_color }}>
          <Row gap={t.spacing.lg}>
            {logoSrc ? (
              <Image source={{ uri: logoSrc }} style={{ width: 96, height: 48 }} resizeMode="contain" accessibilityLabel={v.company_name} />
            ) : (
              <View style={{ width: 48, height: 48, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', padding: 2 }}>
                <Txt variant="caption" tone="muted" style={{ fontSize: 9, textAlign: 'center' }}>
                  {tr('settings.no_logo')}
                </Txt>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {v.company_name}
              </Txt>
              {v.tagline ? (
                <Txt variant="caption" tone="secondary" numberOfLines={1}>
                  {v.tagline}
                </Txt>
              ) : null}
            </View>
          </Row>
        </Card>

        <TextField label={tr('settings.company_name')} value={v.company_name} onChangeText={(x) => set('company_name', x)} editable={canWrite} error={errs.company_name} required />
        <TextField label={tr('settings.tagline')} value={v.tagline} onChangeText={(x) => set('tagline', x)} editable={canWrite} error={errs.tagline} />

        <View style={{ gap: t.spacing.sm }}>
          <TextField
            label={tr('settings.primary_color')}
            value={colorText}
            editable={canWrite}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            left={<View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: v.primary_color, borderWidth: 1, borderColor: t.colors.border }} />}
            onChangeText={(text) => {
              const next = text.trim();
              if (/^#?[0-9A-Fa-f]{0,6}$/.test(next)) {
                const withHash = next.startsWith('#') ? next : `#${next}`;
                setColorText(withHash.toUpperCase());
                if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) set('primary_color', withHash.toUpperCase());
              }
            }}
            onBlur={() => commitColor(colorText)}
            error={errs.primary_color}
          />
          {canWrite ? (
            <Row gap={t.spacing.sm} wrap>
              {SWATCHES.map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  accessibilityLabel={c}
                  accessibilityState={{ selected: v.primary_color.toUpperCase() === c }}
                  onPress={() => {
                    set('primary_color', c);
                    setColorText(c);
                  }}
                  hitSlop={4}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: v.primary_color.toUpperCase() === c ? 3 : 1, borderColor: v.primary_color.toUpperCase() === c ? t.colors.text : t.colors.border }}
                />
              ))}
            </Row>
          ) : null}
        </View>

        <View style={{ gap: 6 }}>
          <Txt variant="caption" tone="secondary" style={{ fontWeight: '600' }}>
            {tr('settings.paper_size')}
          </Txt>
          <Segmented<PaperSize>
            value={v.paper_size}
            onChange={(x) => canWrite && set('paper_size', x)}
            options={PAPER_SIZES.map((size) => ({ value: size, label: tr(`settings.paper_sizes.${size.toLowerCase()}`) }))}
          />
        </View>

        <Card style={{ gap: t.spacing.sm }}>
          <Row gap={t.spacing.sm}>
            <ImageIcon size={16} color={t.colors.textSecondary} />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {tr('settings.upload_logo')}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {tr('mobile.settings.logo_on_web')}
          </Txt>
          {settings.logo_url && canWrite ? (
            <Button variant="outline" size="sm" label={tr('settings.remove_logo')} loading={removeLogo.isPending} onPress={() => removeLogo.mutate(undefined)} />
          ) : null}
        </Card>
      </Section>

      <Section title={tr('settings.form.section_contact')}>
        <Row gap={t.spacing.sm}>
          <Contact size={16} color={t.colors.textSecondary} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
            {tr('settings.contact_hint')}
          </Txt>
        </Row>
        <TextField label={tr('settings.address')} value={v.address} onChangeText={(x) => set('address', x)} editable={canWrite} multiline error={errs.address} />
        <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <TextField label={tr('settings.city')} value={v.city} onChangeText={(x) => set('city', x)} editable={canWrite} error={errs.city} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={tr('settings.district')} value={v.district} onChangeText={(x) => set('district', x)} editable={canWrite} error={errs.district} />
          </View>
        </Row>
        <TextField label={tr('settings.phone')} value={v.phone} onChangeText={(x) => set('phone', x)} editable={canWrite} keyboardType="phone-pad" error={errs.phone} />
        <TextField label={tr('settings.email')} value={v.email} onChangeText={(x) => set('email', x)} editable={canWrite} keyboardType="email-address" autoCapitalize="none" error={errs.email} />
        <TextField label={tr('settings.website')} value={v.website} onChangeText={(x) => set('website', x)} editable={canWrite} keyboardType="url" autoCapitalize="none" error={errs.website} />
        <TextField label={tr('settings.footer_text')} value={v.footer_text} onChangeText={(x) => set('footer_text', x)} editable={canWrite} multiline error={errs.footer_text} />
      </Section>

      {!canWrite ? (
        <Txt variant="caption" tone="muted">
          {tr('settings.read_only')}
        </Txt>
      ) : null}
    </Screen>
  );
}
