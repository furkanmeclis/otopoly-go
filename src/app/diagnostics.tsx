import { useQueryClient } from '@tanstack/react-query';
import { Database, Share2, Trash2 } from 'lucide-react-native';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, Share, View } from 'react-native';

import { DEMO_EMAIL_CODE, DEMO_REVIEW_EMAILS, DEMO_TOTP_CODE, getIssuedCodes, subscribeIssuedCodes } from '@/api/mock/demo-auth';
import { getPlanScenario, PLAN_SCENARIOS, setPlanScenario, subscribePlanScenario, type PlanScenario } from '@/api/mock/scenario';
import { useToast } from '@/components/feedback/toast';
import { Badge, Button, EmptyState, FilterChips, Header, Row, Screen, Txt, useConfirm } from '@/components/ui';
import { env, isMock } from '@/config/env';
import { useAuth } from '@/features/auth/auth-provider';
import { useLocale } from '@/lib/i18n/provider';
import { clearLogEntries, formatLogsForExport, getLogEntries, subscribeLogs, type LogLevel } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

type Filter = 'all' | LogLevel;

export default function DiagnosticsScreen() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { status, logout } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const version = useSyncExternalStore(subscribeLogs, () => getLogEntries().length + (getLogEntries().at(-1)?.id ?? 0));
  const entries = useMemo(() => {
    void version;
    const all = [...getLogEntries()].reverse();
    return filter === 'all' ? all : all.filter((e) => e.level === filter);
  }, [filter, version]);

  const tone = (l: LogLevel) => (l === 'error' ? 'danger' : l === 'warn' ? 'warning' : l === 'info' ? 'info' : 'neutral');

  const resetDemo = async () => {
    if (!(await confirm({ title: tr('mobile.diagnostics.reset_demo'), message: tr('mobile.diagnostics.reset_demo_confirm'), destructive: true }))) return;
    const { resetMockData } = await import('@/api/mock');
    await resetMockData();
    toast.success(tr('mobile.diagnostics.reset_done'));
    if (status === 'ready' || status === 'selectOrg') await logout();
  };

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={tr('mobile.diagnostics.title')}
          subtitle={`${env.apiMode.toUpperCase()} · ${isMock ? 'in-app mock' : env.apiUrl}`}
        />
      }
      footer={
        <Row gap={t.spacing.sm}>
          <Button
            label={tr('mobile.diagnostics.share')}
            icon={<Share2 size={18} color={t.colors.onPrimary} />}
            style={{ flex: 1 }}
            onPress={() => Share.share({ message: formatLogsForExport() || '—' })}
          />
          <Button label={tr('mobile.diagnostics.clear')} variant="outline" icon={<Trash2 size={18} color={t.colors.text} />} onPress={clearLogEntries} />
        </Row>
      }
    >
      <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md, paddingBottom: t.spacing.md }}>
        <FilterChips<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: tr('mobile.common.all'), count: getLogEntries().length },
            { value: 'error', label: 'Error', count: getLogEntries().filter((e) => e.level === 'error').length },
            { value: 'warn', label: 'Warn', count: getLogEntries().filter((e) => e.level === 'warn').length },
            { value: 'info', label: 'Info' },
            { value: 'debug', label: 'Debug' },
          ]}
        />
        {isMock ? <PlanScenarioSwitch /> : null}
        {isMock ? <DemoAuthCodes /> : null}
        {isMock ? <Button label={tr('mobile.diagnostics.reset_demo')} size="sm" variant="ghost" icon={<Database size={16} color={t.colors.primary} />} onPress={resetDemo} /> : null}
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xl, gap: t.spacing.sm }}
        ListEmptyComponent={<EmptyState title={tr('mobile.diagnostics.empty')} description="" />}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: t.colors.surface, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, padding: t.spacing.md, gap: 4 }}>
            <Row gap={t.spacing.sm}>
              <Badge size="sm" tone={tone(item.level)} label={item.level.toUpperCase()} />
              <Txt variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
                {item.scope}
              </Txt>
              <Txt variant="caption" tone="muted">
                {fmt.time(item.ts)}
              </Txt>
            </Row>
            <Txt variant="caption" selectable>
              {item.message}
            </Txt>
            {item.data !== undefined ? (
              <Txt variant="caption" tone="secondary" selectable numberOfLines={6} style={{ fontFamily: 'Menlo' }}>
                {JSON.stringify(item.data)}
              </Txt>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}

/**
 * Demo only: switches the mock's plan scenario (usage near / at the limit, modules off) so the
 * usage screen, the LIMIT_REACHED dialog and the locked states can be shown as owner and as staff.
 */
function PlanScenarioSwitch() {
  const t = useTheme();
  const { t: tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const scenario = useSyncExternalStore(subscribePlanScenario, getPlanScenario);
  const change = (next: PlanScenario) => {
    setPlanScenario(next);
    void qc.invalidateQueries();
    toast.info(tr('mobile.plan.scenario.changed', { name: tr(`mobile.plan.scenario.${next}`) }));
  };
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.plan.scenario.title')}
      </Txt>
      <FilterChips<PlanScenario> value={scenario} onChange={change} options={PLAN_SCENARIOS.map((s) => ({ value: s, label: tr(`mobile.plan.scenario.${s}`) }))} />
      <Txt variant="caption" tone="muted">
        {tr('mobile.plan.scenario.hint')}
      </Txt>
    </View>
  );
}

/** Demo only: the e-mail codes the mock "sent" (sign-in, Apple linking, account deletion). */
function DemoAuthCodes() {
  const t = useTheme();
  const { t: tr, fmt } = useLocale();
  const codes = useSyncExternalStore(subscribeIssuedCodes, getIssuedCodes);
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Txt variant="caption" tone="secondary">
        {tr('mobile.auth.demo.codes_title')}
      </Txt>
      <Txt variant="caption" tone="muted">
        {tr('mobile.auth.demo.codes_fixed', { code: DEMO_EMAIL_CODE, emails: DEMO_REVIEW_EMAILS.join(', '), totp: DEMO_TOTP_CODE })}
      </Txt>
      {codes.length === 0 ? (
        <Txt variant="caption" tone="muted">
          {tr('mobile.auth.demo.codes_empty')}
        </Txt>
      ) : (
        codes.slice(0, 3).map((c) => (
          <Row key={`${c.at}-${c.email}`} gap={t.spacing.sm}>
            <Txt variant="mono" selectable>
              {c.code}
            </Txt>
            <Txt variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
              {`${tr(`mobile.auth.demo.purpose.${c.purpose}`)} · ${c.email}`}
            </Txt>
            <Txt variant="caption" tone="muted">
              {fmt.time(new Date(c.at))}
            </Txt>
          </Row>
        ))
      )}
    </View>
  );
}
