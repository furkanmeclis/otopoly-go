/**
 * Self-service business creation for a signed-in user without one (decision: new users create their own
 * business in the app). Two steps like the web wizard (business details, starter services), then:
 * create organization → reload profile → enter it (organization token) → add the picked services (best
 * effort) → Home with the welcome title. If the app is killed after the organization exists, the next
 * boot finds exactly one organization and goes straight in.
 */
import { router } from 'expo-router';
import { Building2, Check, Sparkles, Wrench } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { isApiError } from '@/api/errors';
import { useToast } from '@/components/feedback/toast';
import { Button, Card, Header, Row, Screen, SelectField, TextField, Txt } from '@/components/ui';
import { authService } from '@/features/account/services/auth.service';
import { orgBlock, useAuth } from '@/features/auth/auth-provider';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { TR_PROVINCES } from '@/features/onboarding/data/provinces';
import { normalizePrice, STARTER_SERVICES, type StarterService } from '@/features/onboarding/data/starter-services';
import { onboardingService, type CreateOrganizationInput } from '@/features/onboarding/services/onboarding.service';
import { setWelcomePending } from '@/features/onboarding/state';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

const log = createLogger('onboarding.create');

type Values = Required<CreateOrganizationInput>;
type Field = keyof Values;
type Task = 'create' | 'services' | 'enter';
type TaskState = 'pending' | 'running' | 'done' | 'skipped';

const EMPTY: Values = { organization_name: '', phone: '', city: '', district: '', address: '' };
const PROVINCE_OPTIONS = TR_PROVINCES.map((name) => ({ value: name, label: name }));
const STEPS = 2;

/** Same required fields as the web wizard, plus the API's 2-120 name rule and a plausible phone. */
function validateBusiness(values: Values, tr: (key: string) => string) {
  const errors: Partial<Record<Field, string>> = {};
  const name = values.organization_name.trim();
  if (!name) errors.organization_name = tr('register.validation.organization_name_required');
  else if (name.length < 2 || name.length > 120) errors.organization_name = tr('mobile.onboarding.create.name_length');
  const digits = values.phone.replace(/\D/g, '');
  if (!values.phone.trim()) errors.phone = tr('register.validation.phone_required');
  else if (digits.length < 10 || digits.length > 13) errors.phone = tr('mobile.onboarding.create.phone_invalid');
  if (!values.city) errors.city = tr('register.validation.city_required');
  if (!values.district.trim()) errors.district = tr('register.validation.district_required');
  if (!values.address.trim()) errors.address = tr('register.validation.address_required');
  return errors;
}

export default function CreateBusinessScreen() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const { enterNewOrganization, refreshMe } = useAuth();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [services, setServices] = useState<StarterService[]>(() => STARTER_SERVICES.map((s) => ({ ...s })));
  const [formError, setFormError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<Task, TaskState> | null>(null);
  const running = useRef(false);

  const picked = useMemo(() => services.filter((s) => s.selected && s.name.trim()), [services]);
  const set = (field: Field) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const setTask = (task: Task, state: TaskState) => setTasks((prev) => (prev ? { ...prev, [task]: state } : prev));

  const next = () => {
    const found = validateBusiness(values, tr);
    setErrors(found);
    if (Object.keys(found).length) return;
    setFormError(null);
    setStep(1);
  };

  const back = () => {
    if (tasks) return;
    if (step > 0) setStep(step - 1);
    else router.back();
  };

  /** Opens the business and lands on Home; the picked services are added with its token first. */
  const enter = async (slug: string, withServices: StarterService[]) => {
    let failed = 0;
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
      setTask('enter', 'running');
    });
    setWelcomePending(slug);
    if (failed) toast.info(tr('mobile.onboarding.create.services_partial'));
    log.info('Business created and entered', { slug, services: withServices.length, failed });
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
    await enter(owned.slug, []);
    return true;
  };

  const submit = async () => {
    if (running.current) return;
    const found = validateBusiness(values, tr);
    if (Object.keys(found).length) {
      setErrors(found);
      setStep(0);
      return;
    }
    running.current = true;
    setFormError(null);
    const withServices = picked;
    setTasks({ create: 'running', services: withServices.length ? 'pending' : 'skipped', enter: 'pending' });
    const body: CreateOrganizationInput = { organization_name: values.organization_name.trim() };
    for (const key of ['phone', 'city', 'district', 'address'] as const) if (values[key].trim()) body[key] = values[key].trim();

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
      if (code === 'CONFLICT') {
        setFormError((prev) => prev ?? tr('mobile.onboarding.create.error_conflict_missing'));
      } else if (code === 'VALIDATION_ERROR' && isApiError(error)) {
        const fields = error.fieldErrors();
        const mapped: Partial<Record<Field, string>> = {};
        for (const key of Object.keys(EMPTY) as Field[]) if (fields[key]) mapped[key] = key === 'organization_name' ? tr('mobile.onboarding.create.name_length') : fields[key];
        setErrors(mapped);
        setFormError(tr('mobile.onboarding.create.error_validation'));
        if (Object.keys(mapped).length) setStep(0);
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
      await enter(slug, withServices);
    } catch (error) {
      // The business exists; the organization picker lists it (or the next launch opens it).
      log.warn('Entering the new business failed', error);
      await refreshMe().catch(() => {});
      toast.error(tr('mobile.onboarding.create.error_enter'));
      running.current = false;
      router.back();
    }
  };

  if (tasks) return <ProgressView tasks={tasks} />;

  return (
    <Screen
      header={<Header title={tr('mobile.onboarding.create.title')} subtitle={tr('register.onboarding.step_of', { current: step + 1, total: STEPS })} onBack={back} />}
      footer={
        step === 0 ? (
          <Button label={tr('register.onboarding.next')} onPress={next} />
        ) : (
          <>
            <Button label={tr('mobile.onboarding.create.submit')} icon={<Sparkles size={18} color={t.colors.onPrimary} />} onPress={() => void submit()} />
            <Button label={tr('register.onboarding.back')} variant="ghost" size="sm" onPress={back} />
          </>
        )
      }
    >
      <View style={{ flexDirection: 'row', gap: 6 }} accessible={false} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: STEPS }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? t.colors.primary : t.colors.surfaceSunken }} />
        ))}
      </View>

      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          {step === 0 ? <Building2 size={22} color={t.colors.primary} /> : <Wrench size={22} color={t.colors.primary} />}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="heading" accessibilityRole="header">
            {step === 0 ? tr('register.onboarding.business.title') : tr('register.onboarding.services.title')}
          </Txt>
          <Txt tone="secondary" variant="caption">
            {step === 0 ? tr('register.onboarding.business.description') : tr('register.onboarding.services.description')}
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

      {step === 0 ? (
        <View style={{ gap: t.spacing.md }}>
          <TextField
            label={tr('register.fields.organization_name')}
            placeholder={tr('register.onboarding.business.name_placeholder')}
            value={values.organization_name}
            onChangeText={set('organization_name')}
            error={errors.organization_name}
            maxLength={120}
            autoCapitalize="words"
            autoFocus
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
            required
          />
          <TextField
            label={tr('register.fields.address')}
            value={values.address}
            onChangeText={set('address')}
            error={errors.address}
            multiline
            textContentType="fullStreetAddress"
            required
          />
        </View>
      ) : (
        <ServicesStep services={services} onChange={setServices} pickedCount={picked.length} />
      )}
    </Screen>
  );
}

function ServicesStep({ services, onChange, pickedCount }: { services: StarterService[]; onChange: (next: StarterService[]) => void; pickedCount: number }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const update = (key: string, patch: Partial<StarterService>) => onChange(services.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  return (
    <View style={{ gap: t.spacing.md }}>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.onboarding.create.services_selected', { count: pickedCount })}
      </Txt>
      <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, overflow: 'hidden' }}>
        {services.map((service, i) => (
          <View
            key={service.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.md,
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
              <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {service.name}
              </Txt>
            </Pressable>
            <View style={{ width: 116 }}>
              <TextField
                value={service.price}
                onChangeText={(price) => update(service.key, { price })}
                keyboardType="decimal-pad"
                editable={service.selected}
                accessibilityLabel={`${service.name} · ${tr('register.onboarding.services.price')}`}
                style={{ textAlign: 'right' }}
                right={<Txt tone="muted">₺</Txt>}
              />
            </View>
          </View>
        ))}
      </View>
      <Txt variant="caption" tone="muted">
        {tr('register.onboarding.services.hint')}
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
