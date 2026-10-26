/**
 * "Create your business": the setup wizard for a signed-in user without a business (new e-mail sign-up,
 * first Apple / Google sign-in, or a user whose business is gone). Steps:
 *   1. business type  — organization `sector` (sent on create) + the starter service template,
 *   2. business info  — name, phone, province, district, address (POST /v1/auth/organizations),
 *   3. starter services — editable names / prices, own services can be added,
 *   4. logo (optional) — uploaded as the letterhead logo once the business exists.
 * Then: create organization → enter it (organization token) → add the services and the logo (best effort)
 * → Home with the welcome title. The draft is saved per user, so leaving the app and coming back resumes
 * where it stopped. If the app is killed after the organization exists, the next boot opens it directly.
 */
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Building2, Car, Check, CircleDashed, Droplets, Image as ImageIcon, LogOut, Plus, Shield, Sparkles, Trash2, Wrench, type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import type { UploadFile } from '@/api/files';
import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Button, Card, EmptyState, Header, IconButton, Row, Screen, SelectField, TextField, Txt } from '@/components/ui';
import { authService } from '@/features/account/services/auth.service';
import { orgBlock, useAuth } from '@/features/auth/auth-provider';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { exportSettingsService, LOGO_MAX_BYTES, LOGO_TYPES } from '@/features/export-settings/service';
import { TR_PROVINCES } from '@/features/onboarding/data/provinces';
import { SECTOR_KEYS, servicesFor, toSectorKey, type SectorKey } from '@/features/onboarding/data/sectors';
import { normalizePrice, type StarterService } from '@/features/onboarding/data/starter-services';
import { onboardingService, registrationOpen, type CreateOrganizationInput } from '@/features/onboarding/services/onboarding.service';
import { setWelcomePending } from '@/features/onboarding/state';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useMarkInteractive } from '@/lib/monitoring/observe';
import { prefs, StorageKeys } from '@/lib/storage';
import { useTheme } from '@/theme/provider';

const log = createLogger('onboarding.create');

type Values = Required<Omit<CreateOrganizationInput, 'sector'>>;
type Field = keyof Values;
type Task = 'create' | 'services' | 'logo' | 'enter';
type TaskState = 'pending' | 'running' | 'done' | 'skipped';
type StepKey = 'sector' | 'business' | 'services' | 'logo';

const STEPS: StepKey[] = ['sector', 'business', 'services', 'logo'];
const EMPTY: Values = { organization_name: '', phone: '', city: '', district: '', address: '' };
const PROVINCE_OPTIONS = TR_PROVINCES.map((name) => ({ value: name, label: name }));

type Draft = { step: number; values: Values; sector: SectorKey | null; services: StarterService[] };

/** Name (API: 2-120), phone and province are asked for; district and address can follow later in settings. */
function validateBusiness(values: Values, tr: (key: string) => string) {
  const errors: Partial<Record<Field, string>> = {};
  const name = values.organization_name.trim();
  if (!name) errors.organization_name = tr('register.validation.organization_name_required');
  else if (name.length < 2 || name.length > 120) errors.organization_name = tr('mobile.onboarding.create.name_length');
  const digits = values.phone.replace(/\D/g, '');
  if (!values.phone.trim()) errors.phone = tr('register.validation.phone_required');
  else if (digits.length < 10 || digits.length > 13) errors.phone = tr('mobile.onboarding.create.phone_invalid');
  if (!values.city) errors.city = tr('register.validation.city_required');
  return errors;
}

export default function CreateBusinessScreen() {
  useMarkInteractive();
  const t = useTheme();
  const { t: tr, locale } = useLocale();
  const toast = useToast();
  const { me, enterNewOrganization, refreshMe, logout } = useAuth();
  const config = useQuery({ queryKey: ['app', 'config'], queryFn: () => onboardingService.appConfig(), staleTime: 5 * 60 * 1000 });
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY);
  const [sector, setSector] = useState<SectorKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [services, setServices] = useState<StarterService[]>(() => servicesFor('car_wash', locale));
  const [logo, setLogo] = useState<UploadFile | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<Task, TaskState> | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const running = useRef(false);
  const draftKey = `${StorageKeys.onboardingBusinessDraft}.${me?.user.uuid ?? 'anon'}`;
  const stepKey = STEPS[step];

  // Resume an unfinished wizard (the logo is not kept: the picked file may be gone from the cache).
  useEffect(() => {
    let active = true;
    prefs.get<Draft | null>(draftKey, null).then((draft) => {
      if (!active) return;
      if (draft?.values) {
        setValues({ ...EMPTY, ...draft.values });
        setSector(toSectorKey(draft.sector));
        if (draft.services?.length) setServices(draft.services);
        setStep(Math.min(Math.max(0, draft.step), STEPS.length - 1));
        log.info('Business draft resumed', { step: draft.step });
      }
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draftLoaded || tasks) return;
    void prefs.set(draftKey, { step, values, sector, services } satisfies Draft);
  }, [draftKey, draftLoaded, step, values, sector, services, tasks]);

  const picked = useMemo(() => services.filter((s) => s.selected && s.name.trim()), [services]);
  const set = (field: Field) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const setTask = (task: Task, state: TaskState) => setTasks((prev) => (prev ? { ...prev, [task]: state } : prev));

  const chooseSector = (key: SectorKey) => {
    Haptics.selectionAsync().catch(() => {});
    if (key !== sector) setServices(servicesFor(key, locale));
    setSector(key);
  };

  const next = () => {
    if (stepKey === 'business') {
      const found = validateBusiness(values, tr);
      setErrors(found);
      if (Object.keys(found).length) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
    }
    if (stepKey === 'sector' && !sector) chooseSector('other');
    setFormError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => {
    if (tasks) return;
    if (step > 0) setStep(step - 1);
    else if (router.canGoBack()) router.back();
    else router.replace('/select-org');
  };

  /** Opens the business and lands on Home; the picked services and the logo are added with its token first. */
  const enter = async (slug: string, withServices: StarterService[], withLogo: UploadFile | null) => {
    let failed = 0;
    let logoFailed = false;
    await enterNewOrganization(slug, async () => {
      if (withServices.length) {
        setTask('services', 'running');
        // Best effort: the business exists already; missing services can be added later in the catalog.
        const results = await Promise.allSettled(
          withServices.map((service) =>
            catalogService.createService({ name: service.name.trim(), price: normalizePrice(service.price) || '0', currency: 'TRY', is_active: true }),
          ),
        );
        failed = results.filter((r) => r.status === 'rejected').length;
        setTask('services', 'done');
      }
      if (withLogo) {
        setTask('logo', 'running');
        try {
          await exportSettingsService.uploadLogo(withLogo);
        } catch (error) {
          logoFailed = true;
          log.warn('Logo upload failed', isApiError(error) ? error.code : error);
        }
        setTask('logo', 'done');
      }
      setTask('enter', 'running');
    });
    setWelcomePending(slug);
    void prefs.remove(draftKey);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (failed) toast.info(tr('mobile.onboarding.create.services_partial'));
    if (logoFailed) toast.info(tr('mobile.onboarding.wizard.logo_failed'));
    log.info('Business created and entered', { slug, services: withServices.length, failed, logo: Boolean(withLogo) });
    // The guard switches to the app on the next render; replace afterwards so Home gets `welcome`.
    setTimeout(() => router.replace('/?welcome=1'), 0);
  };

  /** 409: the user already owns a business (e.g. created on the web, or a retried request). */
  const openOwned = async () => {
    const profile = await authService.getMe();
    const owned = profile.organizations?.find((o) => o.role === 'owner' && !orgBlock(o));
    if (!owned) {
      await refreshMe();
      setFormError(tr('mobile.onboarding.create.error_conflict_missing'));
      return false;
    }
    toast.info(tr('mobile.onboarding.create.error_conflict'));
    await enter(owned.slug, [], null);
    return true;
  };

  const submit = async () => {
    if (running.current) return;
    const found = validateBusiness(values, tr);
    if (Object.keys(found).length) {
      setErrors(found);
      setStep(STEPS.indexOf('business'));
      return;
    }
    running.current = true;
    setFormError(null);
    const withServices = picked;
    const withLogo = logo;
    setTasks({ create: 'running', services: withServices.length ? 'pending' : 'skipped', logo: withLogo ? 'pending' : 'skipped', enter: 'pending' });
    const body: CreateOrganizationInput = { organization_name: values.organization_name.trim() };
    for (const key of ['phone', 'city', 'district', 'address'] as const) if (values[key].trim()) body[key] = values[key].trim();
    if (sector) body.sector = sector;

    let slug: string;
    try {
      slug = (await onboardingService.createOrganization(body)).organization.slug;
    } catch (error) {
      const code = isApiError(error) ? error.code : '';
      log.warn('Business creation failed', { code });
      try {
        if (code === 'CONFLICT' && (await openOwned())) return;
      } catch (inner) {
        log.warn('Opening the owned business failed', inner);
      }
      setTasks(null);
      running.current = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (code === 'CONFLICT') {
        setFormError((prev) => prev ?? tr('mobile.onboarding.create.error_conflict_missing'));
      } else if (code === 'VALIDATION_ERROR' && isApiError(error)) {
        const fields = error.fieldErrors();
        const mapped: Partial<Record<Field, string>> = {};
        for (const key of Object.keys(EMPTY) as Field[]) if (fields[key]) mapped[key] = key === 'organization_name' ? tr('mobile.onboarding.create.name_length') : fields[key];
        setErrors(mapped);
        setFormError(tr('mobile.onboarding.create.error_validation'));
        if (Object.keys(mapped).length) setStep(STEPS.indexOf('business'));
      } else {
        setFormError(
          code === 'FORBIDDEN'
            ? tr('mobile.onboarding.create.error_disabled')
            : code === 'RATE_LIMITED'
              ? tr('mobile.onboarding.create.error_rate')
              : isApiError(error) && error.isNetwork
                ? tr('mobile.onboarding.create.error_network')
                : tr('mobile.onboarding.create.error_generic'),
        );
      }
      return;
    }
    setTask('create', 'done');

    try {
      await enter(slug, withServices, withLogo);
    } catch (error) {
      // The business exists; the organization picker lists it (or the next launch opens it).
      log.warn('Entering the new business failed', error);
      await refreshMe().catch(() => {});
      void prefs.remove(draftKey);
      toast.error(tr('mobile.onboarding.create.error_enter'));
      running.current = false;
      router.back();
    }
  };

  if (tasks) return <ProgressView tasks={tasks} />;

  if (config.isLoading || !draftLoaded) {
    return (
      <Screen header={<Header title={tr('mobile.onboarding.create.title')} />}>
        <ActivityIndicator color={t.colors.primary} />
      </Screen>
    );
  }

  if (config.data && !registrationOpen(config.data)) {
    return (
      <Screen header={<Header title={tr('mobile.onboarding.create.title')} onBack={() => router.replace('/select-org')} />}>
        <EmptyState
          icon={<Building2 size={28} color={t.colors.primary} />}
          title={tr('mobile.onboarding.org.none_title')}
          description={tr('mobile.org.none_description')}
          action={
            <View style={{ gap: t.spacing.sm, alignSelf: 'stretch' }}>
              <Button label={tr('common.back')} variant="outline" onPress={() => router.replace('/select-org')} />
              <Button label={tr('common.logout')} variant="ghost" icon={<LogOut size={18} color={t.colors.primary} />} onPress={() => void logout()} />
            </View>
          }
        />
      </Screen>
    );
  }

  const isLast = step === STEPS.length - 1;
  const meta: Record<StepKey, { icon: LucideIcon; title: string; body: string }> = {
    sector: { icon: Sparkles, title: tr('mobile.onboarding.wizard.sector_title'), body: tr('mobile.onboarding.wizard.sector_body') },
    business: { icon: Building2, title: tr('register.onboarding.business.title'), body: tr('register.onboarding.business.description') },
    services: { icon: Wrench, title: tr('register.onboarding.services.title'), body: tr('register.onboarding.services.description') },
    logo: { icon: ImageIcon, title: tr('mobile.onboarding.wizard.logo_title'), body: tr('mobile.onboarding.wizard.logo_body') },
  };
  const StepIcon = meta[stepKey].icon;

  return (
    // The wizard is the route's root, so the padding matches the keyboard (no offset needed) and the
    // pinned footer buttons stay above it.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={<Header title={tr('mobile.onboarding.create.title')} subtitle={tr('register.onboarding.step_of', { current: step + 1, total: STEPS.length })} onBack={back} />}
        footer={
          isLast ? (
            <>
              <Button label={tr('mobile.onboarding.create.submit')} icon={<Sparkles size={18} color={t.colors.onPrimary} />} onPress={() => void submit()} />
              <Button label={tr('register.onboarding.back')} variant="ghost" size="sm" onPress={back} />
            </>
          ) : (
            <>
              <Button label={tr('register.onboarding.next')} onPress={next} />
              {stepKey === 'sector' ? <Button label={tr('mobile.onboarding.wizard.skip_step')} variant="ghost" size="sm" onPress={() => {
                if (!sector) chooseSector('other');
                setStep(1);
              }} /> : null}
              {stepKey === 'services' ? <Button label={tr('mobile.onboarding.wizard.skip_services')} variant="ghost" size="sm" onPress={() => {
                setServices((list) => list.map((s) => ({ ...s, selected: false })));
                setStep((s) => s + 1);
              }} /> : null}
            </>
          )
        }
      >
        <View style={{ flexDirection: 'row', gap: 6 }} accessible={false} importantForAccessibility="no-hide-descendants">
          {STEPS.map((key, i) => (
            <View key={key} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? t.colors.primary : t.colors.surfaceSunken }} />
          ))}
        </View>

        <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <StepIcon size={22} color={t.colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="heading" accessibilityRole="header">
              {meta[stepKey].title}
            </Txt>
            <Txt tone="secondary" variant="caption">
              {meta[stepKey].body}
            </Txt>
          </View>
        </Row>

        {formError ? (
          <Card style={{ backgroundColor: t.colors.dangerBg, borderColor: t.colors.dangerBg }}>
            <Txt style={{ color: t.colors.danger }} accessibilityRole="alert">
              {formError}
            </Txt>
          </Card>
        ) : null}

        {stepKey === 'sector' ? (
          <SectorStep value={sector} onChange={chooseSector} />
        ) : stepKey === 'business' ? (
          <View style={{ gap: t.spacing.md }}>
            <TextField
              label={tr('register.fields.organization_name')}
              placeholder={tr('register.onboarding.business.name_placeholder')}
              value={values.organization_name}
              onChangeText={set('organization_name')}
              error={errors.organization_name}
              maxLength={120}
              autoCapitalize="words"
              autoComplete="organization"
              textContentType="organizationName"
              required
            />
            <TextField
              label={tr('register.fields.phone')}
              placeholder="05XX XXX XX XX"
              value={values.phone}
              onChangeText={set('phone')}
              error={errors.phone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={20}
              required
            />
            <SelectField
              label={tr('register.fields.city')}
              placeholder={tr('register.onboarding.business.city_placeholder')}
              value={values.city || null}
              options={PROVINCE_OPTIONS}
              onChange={(v) => set('city')(v ?? '')}
              error={errors.city}
              searchable
              required
            />
            <TextField
              label={tr('register.fields.district')}
              placeholder={tr('register.onboarding.business.district_placeholder')}
              value={values.district}
              onChangeText={set('district')}
              error={errors.district}
              autoCapitalize="words"
              maxLength={100}
            />
            <TextField
              label={tr('register.fields.address')}
              value={values.address}
              onChangeText={set('address')}
              error={errors.address}
              hint={tr('mobile.onboarding.wizard.address_hint')}
              multiline
              maxLength={500}
              textContentType="fullStreetAddress"
            />
          </View>
        ) : stepKey === 'services' ? (
          <ServicesStep services={services} onChange={setServices} pickedCount={picked.length} />
        ) : (
          <LogoStep logo={logo} onChange={setLogo} orgName={values.organization_name.trim()} />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────────

const SECTOR_ICONS: Record<SectorKey, LucideIcon> = { car_wash: Droplets, detailing: Sparkles, ppf_tint: Shield, auto_service: Wrench, tyres: Car, other: CircleDashed };

function SectorStep({ value, onChange }: { value: SectorKey | null; onChange: (key: SectorKey) => void }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  // Literal keys (scripts/check-i18n.mjs can't see template keys).
  const label: Record<SectorKey, { title: string; body: string }> = {
    car_wash: { title: tr('mobile.onboarding.sector.car_wash'), body: tr('mobile.onboarding.sector.car_wash_body') },
    detailing: { title: tr('mobile.onboarding.sector.detailing'), body: tr('mobile.onboarding.sector.detailing_body') },
    ppf_tint: { title: tr('mobile.onboarding.sector.ppf_tint'), body: tr('mobile.onboarding.sector.ppf_tint_body') },
    auto_service: { title: tr('mobile.onboarding.sector.auto_service'), body: tr('mobile.onboarding.sector.auto_service_body') },
    tyres: { title: tr('mobile.onboarding.sector.tyres'), body: tr('mobile.onboarding.sector.tyres_body') },
    other: { title: tr('mobile.onboarding.sector.other'), body: tr('mobile.onboarding.sector.other_body') },
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }} accessibilityRole="radiogroup">
      {SECTOR_KEYS.map((key) => {
        const Icon = SECTOR_ICONS[key];
        const active = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label[key].title}. ${label[key].body}`}
            style={({ pressed }) => ({
              width: '47%',
              flexGrow: 1,
              minHeight: 112,
              gap: t.spacing.sm,
              padding: t.spacing.md,
              borderRadius: t.radius.lg,
              borderWidth: 1.5,
              borderColor: active ? t.colors.primary : t.colors.border,
              backgroundColor: active ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
            })}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Icon size={22} color={active ? t.colors.primary : t.colors.textSecondary} />
              {active ? <Check size={18} color={t.colors.primary} /> : null}
            </Row>
            <Txt variant="bodyStrong" numberOfLines={2}>
              {label[key].title}
            </Txt>
            <Txt variant="caption" tone="secondary" numberOfLines={3}>
              {label[key].body}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function ServicesStep({ services, onChange, pickedCount }: { services: StarterService[]; onChange: (next: StarterService[]) => void; pickedCount: number }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const update = (key: string, patch: Partial<StarterService>) => onChange(services.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...services, { key: `custom-${Date.now()}`, name: n, price: price || '0', selected: true }]);
    setName('');
    setPrice('');
    Haptics.selectionAsync().catch(() => {});
  };
  return (
    <View style={{ gap: t.spacing.md }}>
      <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
        {tr('mobile.onboarding.create.services_selected', { count: pickedCount })}
      </Txt>
      <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, overflow: 'hidden' }}>
        {services.map((service, i) => {
          const custom = service.key.startsWith('custom-');
          return (
            <View
              key={service.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.sm,
                paddingHorizontal: t.spacing.md,
                paddingVertical: t.spacing.sm,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: t.colors.border,
                backgroundColor: service.selected ? t.colors.surfaceAlt : t.colors.surface,
              }}
            >
              <Pressable
                onPress={() => update(service.key, { selected: !service.selected })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: service.selected }}
                accessibilityLabel={service.name}
                hitSlop={6}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 44 }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    borderWidth: 1.5,
                    borderColor: service.selected ? t.colors.primary : t.colors.borderStrong,
                    backgroundColor: service.selected ? t.colors.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {service.selected ? <Check size={16} color={t.colors.onPrimary} /> : null}
                </View>
                <Txt variant="bodyStrong" numberOfLines={2} style={{ flex: 1 }}>
                  {service.name}
                </Txt>
              </Pressable>
              <View style={{ width: 112 }}>
                <TextField
                  value={service.price}
                  onChangeText={(p) => update(service.key, { price: p })}
                  keyboardType="decimal-pad"
                  editable={service.selected}
                  accessibilityLabel={`${service.name} · ${tr('register.onboarding.services.price')}`}
                  style={{ textAlign: 'right' }}
                  right={<Txt tone="muted">₺</Txt>}
                />
              </View>
              {custom ? (
                <IconButton
                  variant="ghost"
                  label={tr('mobile.onboarding.wizard.remove_service', { name: service.name })}
                  icon={<Trash2 size={18} color={t.colors.danger} />}
                  onPress={() => onChange(services.filter((s) => s.key !== service.key))}
                />
              ) : null}
            </View>
          );
        })}
      </View>

      <Card style={{ gap: t.spacing.sm }}>
        <Txt variant="label" tone="secondary">
          {tr('mobile.onboarding.wizard.add_service')}
        </Txt>
        <Row gap={t.spacing.sm} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <TextField value={name} onChangeText={setName} placeholder={tr('mobile.onboarding.wizard.service_name')} accessibilityLabel={tr('mobile.onboarding.wizard.service_name')} maxLength={120} returnKeyType="done" onSubmitEditing={add} />
          </View>
          <View style={{ width: 100 }}>
            <TextField value={price} onChangeText={setPrice} placeholder="0" keyboardType="decimal-pad" accessibilityLabel={tr('register.onboarding.services.price')} style={{ textAlign: 'right' }} right={<Txt tone="muted">₺</Txt>} />
          </View>
        </Row>
        <Button label={tr('mobile.onboarding.wizard.add')} variant="outline" size="sm" icon={<Plus size={16} color={t.colors.text} />} onPress={add} disabled={!name.trim()} />
      </Card>
      <Txt variant="caption" tone="muted">
        {tr('register.onboarding.services.hint')}
      </Txt>
    </View>
  );
}

function LogoStep({ logo, onChange, orgName }: { logo: UploadFile | null; onChange: (file: UploadFile | null) => void; orgName: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const pick = async () => {
    try {
      // The system photo picker needs no library permission on iOS 14+ / Android 13+.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, exif: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const type = (asset.mimeType ?? 'image/jpeg').toLowerCase();
      if (!LOGO_TYPES.includes(type)) {
        toast.error(tr('mobile.onboarding.wizard.logo_type'));
        return;
      }
      if (asset.fileSize && asset.fileSize > LOGO_MAX_BYTES) {
        toast.error(tr('mobile.onboarding.wizard.logo_size'));
        return;
      }
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      onChange({ uri: asset.uri, name: asset.fileName?.trim() || `logo.${ext}`, type, size: asset.fileSize });
    } catch (error) {
      log.warn('Logo picker failed', error);
      toast.error(tr('mobile.uploads.picker_failed'));
    }
  };
  return (
    <View style={{ alignItems: 'center', gap: t.spacing.lg, paddingVertical: t.spacing.lg }}>
      <Pressable
        onPress={() => void pick()}
        accessibilityRole="button"
        accessibilityLabel={logo ? tr('mobile.onboarding.wizard.logo_change') : tr('mobile.onboarding.wizard.logo_pick')}
        style={({ pressed }) => ({
          width: 140,
          height: 140,
          borderRadius: 28,
          borderWidth: logo ? 1 : 2,
          borderStyle: logo ? 'solid' : 'dashed',
          borderColor: logo ? t.colors.border : t.colors.borderStrong,
          backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        })}
      >
        {logo ? (
          <Image source={{ uri: logo.uri }} style={{ width: 140, height: 140 }} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ alignItems: 'center', gap: t.spacing.sm }}>
            <ImageIcon size={32} color={t.colors.textMuted} />
            <Txt variant="caption" tone="secondary">
              {tr('mobile.onboarding.wizard.logo_pick')}
            </Txt>
          </View>
        )}
      </Pressable>
      {orgName ? (
        <Txt variant="heading" numberOfLines={2} style={{ textAlign: 'center' }}>
          {orgName}
        </Txt>
      ) : null}
      {logo ? (
        <Row gap={t.spacing.sm}>
          <Button label={tr('mobile.onboarding.wizard.logo_change')} variant="outline" size="sm" onPress={() => void pick()} />
          <Button label={tr('mobile.onboarding.wizard.logo_remove')} variant="ghost" size="sm" onPress={() => onChange(null)} />
        </Row>
      ) : null}
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {tr('mobile.onboarding.wizard.logo_hint')}
      </Txt>
    </View>
  );
}

function ProgressView({ tasks }: { tasks: Record<Task, TaskState> }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const rows: { task: Task; label: string }[] = [
    { task: 'create', label: tr('mobile.onboarding.create.working_create') },
    { task: 'services', label: tr('mobile.onboarding.create.working_services') },
    { task: 'logo', label: tr('mobile.onboarding.wizard.working_logo') },
    { task: 'enter', label: tr('mobile.onboarding.create.working_enter') },
  ];
  return (
    <Screen scroll={false} edges={['top', 'bottom']} contentStyle={{ alignItems: 'center', justifyContent: 'center', gap: t.spacing.xl, padding: t.spacing.xl }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Sparkles size={28} color={t.colors.primary} />
      </View>
      <Txt variant="title" accessibilityRole="header" accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
        {tr('mobile.onboarding.create.working_title')}
      </Txt>
      <View style={{ gap: t.spacing.md, alignSelf: 'stretch', maxWidth: 320, marginHorizontal: 'auto' }}>
        {rows
          .filter((r) => tasks[r.task] !== 'skipped')
          .map(({ task, label }) => {
            const state = tasks[task];
            return (
              <View key={task} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }} accessible accessibilityLabel={label} accessibilityState={{ busy: state === 'running', checked: state === 'done' }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    borderWidth: 1.5,
                    borderColor: state === 'done' ? t.colors.success : state === 'running' ? t.colors.primary : t.colors.border,
                    backgroundColor: state === 'done' ? t.colors.success : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state === 'done' ? <Check size={15} color={t.colors.onPrimary} /> : state === 'running' ? <ActivityIndicator size="small" color={t.colors.primary} /> : null}
                </View>
                <Txt tone={state === 'pending' ? 'muted' : 'default'}>{label}</Txt>
              </View>
            );
          })}
      </View>
    </Screen>
  );
}
