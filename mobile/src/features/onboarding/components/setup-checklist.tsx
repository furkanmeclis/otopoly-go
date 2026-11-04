/**
 * Home → "Getting started" card: the first steps of a new business (services, first customer, first job,
 * first sale, WhatsApp / SMS, staff, contract template) with live progress. Each row opens the screen that
 * does the step; finished steps are read from the data (one-row list calls) and remembered on the device
 * (`features/onboarding/setup.ts`). Rows can be skipped, the card hidden and brought back from the menu.
 * Shows the first open steps only; "Show all" lists the rest.
 */
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, ChevronRight, Circle, ClipboardList, FileSignature, MessageCircle, PartyPopper, ShoppingBag, Sparkles, UserPlus, Users, Wrench, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { request } from '@/api/client';
import type { ListPage } from '@/api/types';
import { Button, Card, IconButton, Row, Txt } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { catalogService } from '@/features/catalog/services/catalog.service';
import { customersService } from '@/features/customers/services/customers.service';
import { jobsService } from '@/features/jobs/services/jobs.service';
import type { WhatsAppSession } from '@/features/messaging/types';
import { qk } from '@/features/queries';
import { salesService } from '@/features/sales/services/sales.service';
import { staffService } from '@/features/staff/services/staff.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { isWelcomePending } from '../state';
import { isComplete, loadSetup, saveSetup, setupItems, setupProgress, subscribeSetup, withObserved, type SetupKey, type SetupState } from '../setup';

const log = createLogger('onboarding.setup');
/** Open steps shown before "Show all". */
const COLLAPSED = 3;

const ICONS: Record<SetupKey, LucideIcon> = {
  services: Wrench,
  customer: UserPlus,
  job: ClipboardList,
  sale: ShoppingBag,
  whatsapp: MessageCircle,
  staff: Users,
  contract: FileSignature,
};

/** One-row list calls: `total > 0` means the step happened. Only for steps the user can see. */
function useObserved(keys: Set<SetupKey>) {
  const opts = { staleTime: 60_000, retry: false } as const;
  const services = useQuery({ queryKey: [...qk.catalog, 'services', 'setup'], queryFn: () => catalogService.listServices({ limit: 1, offset: 0 }), enabled: keys.has('services'), ...opts });
  const customers = useQuery({ queryKey: [...qk.customers, 'setup'], queryFn: () => customersService.list({ limit: 1, offset: 0 }), enabled: keys.has('customer'), ...opts });
  const jobs = useQuery({ queryKey: [...qk.jobs, 'setup'], queryFn: () => jobsService.list({ limit: 1, offset: 0 } as never), enabled: keys.has('job'), ...opts });
  const sales = useQuery({ queryKey: [...qk.sales, 'setup'], queryFn: () => salesService.list({ limit: 1, offset: 0 }), enabled: keys.has('sale'), ...opts });
  const staff = useQuery({ queryKey: [...qk.staff, 'list'], queryFn: () => staffService.list(), enabled: keys.has('staff'), ...opts });
  const templates = useQuery({
    queryKey: [...qk.contracts, 'templates', 'count'],
    queryFn: () => request<ListPage<unknown>>('GET', '/v1/tenant/contracts/templates', { query: { limit: 1 }, silent: true }),
    enabled: keys.has('contract'),
    ...opts,
  });
  const session = useQuery({
    queryKey: [...qk.messaging, 'session'],
    queryFn: () => request<WhatsAppSession>('GET', '/v1/tenant/messaging/session', { silent: true }),
    enabled: keys.has('whatsapp'),
    ...opts,
  });
  const all = [services, customers, jobs, sales, staff, templates, session];
  const observed: Partial<Record<SetupKey, boolean>> = {
    services: (services.data?.total ?? 0) > 0,
    customer: (customers.data?.total ?? 0) > 0,
    job: (jobs.data?.total ?? 0) > 0,
    sale: (sales.data?.total ?? 0) > 0,
    // The owner plus at least one more person.
    staff: (staff.data?.total ?? 0) > 1,
    contract: (templates.data?.total ?? 0) > 0,
    // Without the own-number feature messages go from the platform number: nothing to connect.
    whatsapp: session.data ? !session.data.own_number_entitled || session.data.status === 'connected' : false,
  };
  return { observed, loading: all.some((q) => q.isLoading) };
}

export function SetupChecklist() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { me, organization, can } = useAuth();
  const userUuid = me?.user.uuid ?? '';
  const orgSlug = organization?.slug ?? '';
  // `?welcome=1` after creating the business in the app; the in-memory flag covers a hand-off where the
  // param got lost while the navigator switched to the app.
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  const isWelcome = welcome === '1' || isWelcomePending(orgSlug);
  const items = useMemo(() => setupItems(can), [can]);
  const keys = useMemo(() => new Set(items.map((i) => i.key)), [items]);
  const { observed, loading } = useObserved(keys);
  const [state, setState] = useState<SetupState | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userUuid || !orgSlug) return;
    let active = true;
    const read = () =>
      loadSetup(userUuid, orgSlug).then((s) => {
        if (active) setState(s);
      });
    void read();
    const unsubscribe = subscribeSetup((u, o) => {
      if (u === userUuid && o === orgSlug) void read();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userUuid, orgSlug]);

  const update = useCallback(
    (next: SetupState) => {
      setState(next);
      if (userUuid && orgSlug) void saveSetup(userUuid, orgSlug, next);
    },
    [userUuid, orgSlug],
  );

  // What the data shows now is merged in (sticky: a deleted first customer does not reopen the step) and
  // stored; the store's listener brings the saved copy back into state.
  const merged = state && !loading ? withObserved(state, observed) : state;
  useEffect(() => {
    if (!merged || merged === state || !userUuid || !orgSlug) return;
    log.info('Setup steps done', { keys: Object.keys(merged.done) });
    void saveSetup(userUuid, orgSlug, merged);
  }, [merged, state, userUuid, orgSlug]);

  if (!merged || loading || merged.dismissed || !items.length) return null;
  const current = merged;
  const { done, total } = setupProgress(current, items);
  const complete = done === total;
  if (complete && current.celebrated) return null;

  if (complete) {
    return (
      <Card style={{ gap: t.spacing.md, borderColor: t.colors.successBg }}>
        <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.successBg, alignItems: 'center', justifyContent: 'center' }}>
            <PartyPopper size={20} color={t.colors.success} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="heading" accessibilityRole="header">
              {tr('mobile.onboarding.setup.complete_title')}
            </Txt>
            <Txt variant="caption" tone="secondary">
              {tr('mobile.onboarding.setup.complete_body')}
            </Txt>
          </View>
        </Row>
        <Button label={tr('mobile.onboarding.setup.complete_close')} variant="outline" size="sm" onPress={() => update({ ...current, celebrated: true })} />
      </Card>
    );
  }

  const open = items.filter((i) => !isComplete(current, i.key));
  const finished = items.filter((i) => isComplete(current, i.key));
  const visible = expanded ? [...open, ...finished] : open.slice(0, COLLAPSED);
  const hidden = items.length - visible.length;

  // Literal keys (scripts/check-i18n.mjs can't see template keys).
  const copy: Record<SetupKey, { title: string; hint: string }> = {
    services: { title: tr('dashboard.tenant.setup.services.title'), hint: tr('dashboard.tenant.setup.services.hint') },
    customer: { title: tr('dashboard.tenant.setup.customer.title'), hint: tr('dashboard.tenant.setup.customer.hint') },
    job: { title: tr('dashboard.tenant.setup.job.title'), hint: tr('dashboard.tenant.setup.job.hint') },
    sale: { title: tr('mobile.onboarding.setup.sale_title'), hint: tr('mobile.onboarding.setup.sale_hint') },
    whatsapp: { title: tr('dashboard.tenant.setup.whatsapp.title'), hint: tr('dashboard.tenant.setup.whatsapp.hint') },
    staff: { title: tr('mobile.onboarding.setup.staff_title'), hint: tr('mobile.onboarding.setup.staff_hint') },
    contract: { title: tr('dashboard.tenant.setup.contract.title'), hint: tr('dashboard.tenant.setup.contract.hint') },
  };

  return (
    <Card style={{ gap: t.spacing.md, borderColor: t.colors.primarySoft }}>
      <Row gap={t.spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={20} color={t.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="heading" accessibilityRole="header">
            {isWelcome ? tr('dashboard.tenant.setup.welcome_title') : tr('dashboard.tenant.setup.title')}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {tr('dashboard.tenant.setup.progress', { done, total })}
          </Txt>
        </View>
        <IconButton
          variant="ghost"
          label={tr('dashboard.tenant.setup.dismiss')}
          icon={<X size={18} color={t.colors.textMuted} />}
          onPress={() => {
            update({ ...current, dismissed: true });
            log.info('Setup card hidden', { done, total });
          }}
        />
      </Row>
      <View
        style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' }}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={tr('dashboard.tenant.setup.progress', { done, total })}
        accessibilityValue={{ min: 0, max: total, now: done }}
      >
        <View style={{ width: `${(done / total) * 100}%`, height: 6, backgroundColor: t.colors.primary }} />
      </View>
      <View style={{ gap: t.spacing.sm }}>
        {visible.map((item) => {
          const finishedRow = isComplete(current, item.key);
          const Icon = ICONS[item.key];
          const c = copy[item.key];
          return (
            <Pressable
              key={item.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.push(item.href);
              }}
              onLongPress={
                finishedRow
                  ? undefined
                  : () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                      update({ ...current, skipped: { ...current.skipped, [item.key]: true } });
                    }
              }
              accessibilityRole="button"
              accessibilityLabel={`${c.title}. ${finishedRow ? tr('mobile.onboarding.setup.done_a11y') : c.hint}`}
              accessibilityHint={finishedRow ? undefined : tr('mobile.onboarding.setup.skip_hint')}
              accessibilityState={{ checked: finishedRow }}
              accessibilityActions={finishedRow ? undefined : [{ name: 'skip', label: tr('mobile.onboarding.setup.skip') }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'skip') update({ ...current, skipped: { ...current.skipped, [item.key]: true } });
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.md,
                padding: t.spacing.md,
                minHeight: 56,
                borderRadius: t.radius.md,
                borderWidth: 1,
                borderColor: t.colors.border,
                backgroundColor: finishedRow || pressed ? t.colors.surfaceAlt : t.colors.surface,
              })}
            >
              {finishedRow ? <CheckCircle2 size={20} color={t.colors.success} /> : <Circle size={20} color={t.colors.textMuted} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={6}>
                  <Icon size={14} color={t.colors.textSecondary} />
                  <Txt variant="bodyStrong" tone={finishedRow ? 'muted' : 'default'} numberOfLines={2} style={[{ flexShrink: 1 }, finishedRow ? { textDecorationLine: 'line-through' } : null]}>
                    {c.title}
                  </Txt>
                </Row>
                {!finishedRow ? (
                  <Txt variant="caption" tone="secondary" numberOfLines={2}>
                    {c.hint}
                  </Txt>
                ) : current.skipped[item.key] && !current.done[item.key] ? (
                  <Txt variant="caption" tone="muted">
                    {tr('mobile.onboarding.setup.skipped')}
                  </Txt>
                ) : null}
              </View>
              {!finishedRow ? <ChevronRight size={18} color={t.colors.textMuted} /> : null}
            </Pressable>
          );
        })}
      </View>
      {hidden > 0 || expanded ? (
        <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" style={{ alignSelf: 'center', padding: t.spacing.sm, minHeight: 44, justifyContent: 'center' }}>
          <Txt variant="caption" tone="primary" style={{ fontWeight: '700' }}>
            {expanded ? tr('mobile.onboarding.setup.show_less') : tr('mobile.onboarding.setup.show_all', { count: hidden })}
          </Txt>
        </Pressable>
      ) : null}
      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {tr('mobile.onboarding.setup.long_press_hint')}
      </Txt>
    </Card>
  );
}

