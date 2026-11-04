/**
 * Siri / Shortcuts glue (App Intents, iOS only; everything is a no-op elsewhere):
 * - `IntentsSessionWatcher` (root): wipes what Siri can read on sign-out and organization switch, and
 *   asks iOS to refresh the shortcuts when the organization or role changes.
 * - `IntentsSync` (signed-in shell): keeps today's figures and the recent-customer catalog current.
 * - `IntentsInvocationHost` (signed-in shell): runs invocations queued by Siri, the Shortcuts app or
 *   Spotlight — at launch, on foreground and live — after checking the member's permissions.
 */
import { useQuery } from '@tanstack/react-query';
import * as AppIntents from 'expo-app-intents';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/feedback/toast';
import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { customersService } from '@/features/customers/services/customers.service';
import { localToday, shiftDate } from '@/features/jobs/lib/job-ui';
import { jobsService } from '@/features/jobs/services/jobs.service';
import { qk, useJobs, useFinanceToday } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { prefs } from '@/lib/storage';

import { clearIntentsData, intentsAvailable, loadShareCustomers, publishCatalog, refreshShortcuts, subscribeShareCustomers } from './bridge';
import { CATALOG_KINDS, customerCatalog, todayFigures, todayRecord, type TodayFigures } from './catalog';
import { decideIntent, pickInvocation, plateHref, type IntentDecision } from './routing';

const log = createLogger('intents.host');

/** Set once something was shared with Siri, so a signed-out launch only clears when there is data. */
const HAS_DATA_KEY = 'intents.has_data';
const markHasData = () => void prefs.set(HAS_DATA_KEY, true);

const TODAY_REFRESH_MS = 15 * 60_000;

/** Recent-customer window for the Siri catalog. */
const RECENT_DAYS = 30;

// ─── Session watcher (root) ────────────────────────────────────────────────

export function IntentsSessionWatcher() {
  const { status, organization, permissions } = useAuth();
  const available = intentsAvailable();
  const orgId = status === 'ready' ? (organization?.uuid ?? null) : null;
  const lastOrg = useRef<string | null>(null);
  const permKey = [...permissions].sort().join(',');

  useEffect(() => {
    if (!available || status !== 'signedOut') return;
    lastOrg.current = null;
    void (async () => {
      if (!(await prefs.get<boolean>(HAS_DATA_KEY, false))) return;
      await clearIntentsData('signed_out');
      await prefs.set(HAS_DATA_KEY, false);
    })();
  }, [available, status]);

  useEffect(() => {
    if (!available || !orgId) return;
    const previous = lastOrg.current;
    lastOrg.current = orgId;
    void (async () => {
      // Another business's customers and figures must not answer in this one.
      if (previous && previous !== orgId) await clearIntentsData('organization_switch');
      await refreshShortcuts();
    })();
  }, [available, orgId, permKey]);

  return null;
}

// ─── Catalog sync (signed-in shell) ────────────────────────────────────────

export function IntentsSync() {
  const available = intentsAvailable();
  const { can, organization } = useAuth();
  const { fmt } = useLocale();
  const canJobs = can(P.jobsRead);
  const canCustomers = canJobs && can(P.customersRead);
  const today = localToday();
  const from = shiftDate(today, -RECENT_DAYS);
  const [share, setShare] = useState<boolean | null>(null);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    loadShareCustomers().then((v) => alive && setShare(v));
    const off = subscribeShareCustomers(setShare);
    return () => {
      alive = false;
      off();
    };
  }, [available]);

  // Same query keys as the dashboard and the widget: no extra request while those are on screen.
  const jobs = useJobs({ limit: 100, offset: 0, sort: '-started_at', date_from: today, date_to: today, include_open: 'true' }, available && canJobs);
  // "Collected" is the day's real collections (finance ledger), only for members with finance read.
  const canFinance = canJobs && can(P.financeRead);
  const money = useFinanceToday(today, available && canFinance);
  const recentParams = { limit: 100, offset: 0, sort: '-started_at', date_from: from, date_to: today };
  const recent = useQuery({
    queryKey: [...qk.jobs, 'list', recentParams],
    queryFn: () => jobsService.list(recentParams),
    enabled: available && canCustomers && share === true,
    staleTime: 30 * 60_000,
  });

  const orgName = organization?.name ?? '';
  // Republishing retrains Siri's parameters, so the "as of" time alone only refreshes every 15 minutes.
  const lastToday = useRef({ key: '', at: 0 });
  useEffect(() => {
    if (!available) return;
    let figures: TodayFigures | null = null;
    if (canJobs) {
      const list = jobs.data?.items;
      if (!list) return;
      figures = todayFigures(list, shiftDate(today, -1), money.data ? fmt.money(money.data.collected_total, money.data.currency) : '');
    }
    const key = JSON.stringify([orgName, today, figures]);
    const now = Date.now();
    if (key === lastToday.current.key && now - lastToday.current.at < TODAY_REFRESH_MS) return;
    lastToday.current = { key, at: now };
    void publishCatalog(CATALOG_KINDS.today, [todayRecord({ org: orgName, date: today, updated: fmt.time(new Date(now)), figures })]);
    markHasData();
  }, [available, canJobs, jobs.data, money.data, orgName, today, fmt]);

  useEffect(() => {
    if (!available || share === null) return;
    if (!canCustomers || !share) {
      void publishCatalog(CATALOG_KINDS.customers, []);
      return;
    }
    const list = recent.data?.items;
    // Wait for real data: an empty loading state must not wipe the catalog Siri already has.
    if (!list) return;
    void publishCatalog(CATALOG_KINDS.customers, customerCatalog(list));
    markHasData();
  }, [available, canCustomers, share, recent.data]);

  return null;
}

// ─── Invocations (signed-in shell) ─────────────────────────────────────────

/** Tabs are navigated to (params update the mounted tab); other screens are pushed. */
const isTabHref = (href: string) => /^\/(customers|operations)(\?|$)/.test(href);

/** `n` (the invocation id) makes a repeated request re-apply on a tab that is already showing it. */
function go(href: string, nonce: string) {
  if (isTabHref(href)) router.navigate(`${href}${href.includes('?') ? '&' : '?'}n=${encodeURIComponent(nonce)}` as never);
  else router.push(href as never);
}

async function resolvePlate(decision: Extract<IntentDecision, { kind: 'plate' }>) {
  try {
    const page = await customersService.list({ q: decision.plate, limit: 5, offset: 0 } as never);
    const customers = page.items ?? [];
    if (decision.target === 'newJob' && customers.length === 1) {
      const detail = await customersService.get(customers[0].uuid);
      return { href: plateHref('newJob', decision.plate, { customers, vehicles: detail.vehicles }), found: true };
    }
    return { href: plateHref(decision.target, decision.plate, { customers }), found: customers.length > 0 };
  } catch (error) {
    log.warn('Plate lookup failed', error);
    return { href: plateHref(decision.target, decision.plate, null), found: true };
  }
}

export function IntentsInvocationHost() {
  const navReady = Boolean(useRootNavigationState()?.key);
  if (!intentsAvailable() || !navReady) return null;
  return <InvocationConsumer />;
}

function InvocationConsumer() {
  const { can } = useAuth();
  const { t: tr } = useLocale();
  const toast = useToast();
  const handled = useRef(new Set<string>());
  const latest = useRef({ can, tr, toast });
  useEffect(() => {
    latest.current = { can, tr, toast };
  });

  AppIntents.useAppIntents(async (pending) => {
    const { run, discard } = pickInvocation(pending, Date.now(), handled.current);
    for (const invocation of discard) {
      handled.current.add(invocation.id);
      await AppIntents.removePendingInvocationAsync(invocation.id).catch(() => {});
    }
    if (!run) return;
    handled.current.add(run.id);
    const { can: allowed, tr: t, toast: notify } = latest.current;
    const decision = decideIntent(run, allowed);
    log.info('Siri invocation', { name: run.name, decision: decision.kind });
    try {
      if (decision.kind === 'route') go(decision.href, run.id);
      else if (decision.kind === 'plate') {
        const { href, found } = await resolvePlate(decision);
        if (!found) notify.info(t('mobile.intents.plate_not_found', { plate: decision.plate }));
        go(href, run.id);
      } else if (decision.kind === 'denied') notify.error(t('mobile.intents.denied'));
    } finally {
      // Navigation is the whole action, so the invocation is done even when a lookup failed.
      await AppIntents.removePendingInvocationAsync(run.id).catch((error) => log.warn('Invocation remove failed', error));
    }
  });

  return null;
}
