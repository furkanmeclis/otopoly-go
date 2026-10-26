import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import {
  Bell,
  Bug,
  Building2,
  CalendarDays,
  ChartColumn,
  Gauge,
  Download,
  FileSignature,
  FileText,
  Languages,
  Layers,
  ListTodo,
  LogOut,
  Megaphone,
  MessageCircle,
  Moon,
  Package,
  Receipt,
  Repeat,
  ScanQrCode,
  ScrollText,
  Settings2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Upload,
  UserCog,
  UserRound,
  Wallet,
  Wrench,
  Rocket,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { BrandLockup } from '@/components/brand';
import { Avatar, Badge, Group, Header, ListRow, Row, Screen, Section, Segmented, Txt, useConfirm } from '@/components/ui';
import { devToolsEnabled, isMock } from '@/config/env';
import { useAuth } from '@/features/auth/auth-provider';
import { ownerOnly, P, type Gate, type Permission } from '@/features/auth/permissions';
import { useUnreadCount } from '@/features/notifications/queries';
import { reopenSetup } from '@/features/onboarding/setup';
import { useLeadsSummary, useQuotesSummary, useTodosSummary } from '@/features/queries';
import { useReviewSummary } from '@/features/reviews/queries';
import { authService } from '@/features/account/services/auth.service';
import { useLocale } from '@/lib/i18n/provider';
import type { AppLocale } from '@/lib/i18n/translate';
import { createLogger } from '@/lib/logger';
import { useThemeContext, type ThemeMode } from '@/theme/provider';
import { useTheme } from '@/theme/provider';

const log = createLogger('screen.menu');

type Item = { key: string; title: string; icon: ReactNode; href: Href; gate?: Permission | Gate; badge?: { value: number; tone: 'danger' | 'warning' | 'neutral' } };

export default function MenuScreen() {
  const t = useTheme();
  const { t: tr, locale, setLocale } = useLocale();
  const { mode, setMode } = useThemeContext();
  const { me, organization, can, logout, switchOrganization } = useAuth();
  const confirm = useConfirm();
  const todos = useTodosSummary(can(P.todosRead));
  const leads = useLeadsSummary(can(P.leadsRead));
  const quotes = useQuotesSummary(can(P.quotesRead));
  const reviews = useReviewSummary(30, can(P.reviewsRead));
  const unread = useUnreadCount(can(P.notificationsRead));
  const ic = (Icon: typeof Wrench) => <Icon size={20} color={t.colors.primary} />;

  const todoDue = (todos.data?.overdue ?? 0) + (todos.data?.today ?? 0);
  const leadDue = (leads.data?.overdue ?? 0) + (leads.data?.due_today ?? 0);

  // Same groups and permissions as web `tenantNav` (config/nav.ts); tabs cover home/operations/customers/finance summary.
  const groups: { key: string; title: string; items: Item[] }[] = [
    {
      key: 'tenant',
      title: tr('layout.section_tenant'),
      items: [
        { key: 'calendar', title: tr('calendar.title'), icon: ic(CalendarDays), href: '/calendar', gate: P.calendarRead },
        { key: 'staff', title: tr('layout.nav_staff'), icon: ic(UserCog), href: '/staff', gate: P.staffRead },
        { key: 'contracts', title: tr('layout.nav_contracts'), icon: ic(FileText), href: '/contracts', gate: P.contractsRead },
        { key: 'sales', title: tr('layout.nav_sales'), icon: ic(ShoppingBag), href: '/sales', gate: P.salesRead },
        { key: 'reports', title: tr('layout.nav_reports'), icon: ic(ChartColumn), href: '/reports', gate: P.reportsRead },
        { key: 'todos', title: tr('layout.nav_todos'), icon: ic(ListTodo), href: '/todos', gate: P.todosRead, badge: todoDue ? { value: todoDue, tone: (todos.data?.overdue ?? 0) > 0 ? 'danger' : 'neutral' } : undefined },
        { key: 'assistant', title: tr('layout.nav_assistant'), icon: ic(Sparkles), href: '/assistant', gate: P.aiUse },
      ],
    },
    {
      key: 'finance',
      title: tr('layout.section_finance'),
      items: [
        { key: 'accounts', title: tr('layout.nav_finance_accounts'), icon: ic(Wallet), href: '/finance/accounts', gate: P.financeRead },
        { key: 'transactions', title: tr('layout.nav_finance_transactions'), icon: ic(ScrollText), href: '/finance/transactions', gate: P.financeRead },
        { key: 'categories', title: tr('layout.nav_finance_categories'), icon: ic(Settings2), href: '/finance/categories', gate: P.financeRead },
        { key: 'cari', title: tr('layout.nav_cari'), icon: ic(Receipt), href: '/cari', gate: P.cariRead },
      ],
    },
    {
      key: 'customers',
      title: tr('layout.section_customers'),
      items: [
        { key: 'leads', title: tr('layout.nav_leads'), icon: ic(Megaphone), href: '/leads', gate: P.leadsRead, badge: leadDue ? { value: leadDue, tone: (leads.data?.overdue ?? 0) > 0 ? 'danger' : 'neutral' } : undefined },
        { key: 'quotes', title: tr('layout.nav_quotes'), icon: ic(FileSignature), href: '/quotes', gate: P.quotesRead, badge: quotes.data?.expiring_soon ? { value: quotes.data.expiring_soon, tone: 'warning' } : undefined },
        { key: 'reviews', title: tr('layout.nav_reviews'), icon: ic(Star), href: '/reviews', gate: P.reviewsRead, badge: reviews.data?.follow_up_required ? { value: reviews.data.follow_up_required, tone: 'danger' } : undefined },
        { key: 'suppliers', title: tr('layout.nav_suppliers'), icon: ic(Building2), href: '/suppliers', gate: P.suppliersRead },
      ],
    },
    {
      key: 'catalog',
      title: tr('layout.section_catalog'),
      items: [
        { key: 'products', title: tr('layout.nav_catalog_products'), icon: ic(Package), href: '/catalog/products', gate: P.catalogRead },
        { key: 'services', title: tr('layout.nav_catalog_services'), icon: ic(Wrench), href: '/catalog/services', gate: P.catalogRead },
        { key: 'catalog-categories', title: tr('layout.nav_catalog_categories'), icon: ic(Layers), href: '/catalog/categories', gate: P.catalogRead },
        { key: 'purchases', title: tr('layout.nav_purchases'), icon: ic(ShoppingCart), href: '/purchases', gate: P.purchasesRead },
      ],
    },
    {
      key: 'io',
      title: tr('layout.section_io'),
      items: [
        { key: 'exports', title: tr('layout.nav_exports'), icon: ic(Download), href: '/exports', gate: P.financeExport },
        { key: 'imports', title: tr('layout.nav_imports'), icon: ic(Upload), href: '/imports', gate: ownerOnly(P.importsRead) },
        { key: 'export-settings', title: tr('layout.nav_export_settings'), icon: ic(Settings2), href: '/settings/letterhead', gate: ownerOnly(P.settingsRead) },
        { key: 'contract-templates', title: tr('layout.nav_contract_templates'), icon: ic(FileText), href: '/contracts/templates', gate: P.contractsRead },
      ],
    },
    {
      key: 'settings',
      title: tr('layout.section_settings'),
      items: [
        { key: 'messaging', title: tr('layout.nav_messaging'), icon: ic(MessageCircle), href: '/settings/messaging', gate: P.messagingRead },
        { key: 'usage', title: tr('mobile.plan.title'), icon: ic(Gauge), href: '/settings/usage', gate: P.billingRead },
      ],
    },
  ];

  const changeLocale = (next: AppLocale) => {
    setLocale(next);
    // Keep the backend profile in sync (web preferences do the same).
    authService.updateProfile({ locale: next }).catch((error) => log.warn('Profile locale sync failed', error));
  };

  return (
    <Screen header={<Header back={false} title={tr('mobile.tabs.menu')} />}>
      <ListRowCard
        onPress={() => router.push('/profile')}
        title={me ? `${me.user.name} ${me.user.surname}` : ''}
        subtitle={`${organization?.name ?? ''} · ${organization ? tr(`organizations.roles.${organization.role}`) : ''}`}
        email={me?.user.email ?? ''}
      />

      {groups.map((g) => {
        const visible = g.items.filter((i) => can(i.gate));
        if (!visible.length) return null;
        return (
          <Section key={g.key} title={g.title}>
            <Group>
              {visible.map((item, idx) => (
                <ListRow
                  key={item.key}
                  title={item.title}
                  left={item.icon}
                  right={item.badge ? <Badge size="sm" tone={item.badge.tone} label={String(item.badge.value)} /> : undefined}
                  onPress={() => router.push(item.href)}
                  last={idx === visible.length - 1}
                />
              ))}
            </Group>
          </Section>
        );
      })}

      <Section title={tr('mobile.menu.section_account')}>
        <Group>
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <Row gap={t.spacing.sm}>
              <Moon size={18} color={t.colors.textSecondary} />
              <Txt variant="bodyStrong">{tr('mobile.theme.title')}</Txt>
            </Row>
            <Segmented<ThemeMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'system', label: tr('mobile.theme.system') },
                { value: 'light', label: tr('mobile.theme.light') },
                { value: 'dark', label: tr('mobile.theme.dark') },
              ]}
            />
          </View>
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
            <Row gap={t.spacing.sm}>
              <Languages size={18} color={t.colors.textSecondary} />
              <Txt variant="bodyStrong">{tr('mobile.language.title')}</Txt>
            </Row>
            <Segmented<AppLocale>
              value={locale}
              onChange={changeLocale}
              options={[
                { value: 'tr', label: tr('mobile.language.tr') },
                { value: 'en', label: tr('mobile.language.en') },
              ]}
            />
          </View>
          {can(P.notificationsRead) ? (
            <ListRow
              title={tr('notifications.inbox.title')}
              left={<Bell size={20} color={t.colors.textSecondary} />}
              right={unread.data ? <Badge size="sm" tone="danger" label={String(unread.data)} /> : undefined}
              onPress={() => router.push('/notifications')}
            />
          ) : null}
          {me && organization ? (
            <ListRow
              title={tr('mobile.onboarding.setup.menu_title')}
              subtitle={tr('mobile.onboarding.setup.menu_subtitle')}
              left={<Rocket size={20} color={t.colors.textSecondary} />}
              onPress={async () => {
                await reopenSetup(me.user.uuid, organization.slug);
                router.navigate('/');
              }}
            />
          ) : null}
          <ListRow title={tr('layout.nav_profile')} left={<UserRound size={20} color={t.colors.textSecondary} />} onPress={() => router.push('/profile')} />
          <ListRow title={tr('mobile.qr.menu_title')} subtitle={tr('mobile.qr.menu_subtitle')} left={<ScanQrCode size={20} color={t.colors.textSecondary} />} onPress={() => router.push('/qr-scan')} />
          {(me?.organizations?.length ?? 0) > 1 ? <ListRow title={tr('mobile.org.switch')} left={<Repeat size={20} color={t.colors.textSecondary} />} onPress={switchOrganization} /> : null}
          {devToolsEnabled ? (
            <ListRow title={tr('mobile.diagnostics.title')} subtitle={isMock ? tr('mobile.demo.banner') : undefined} left={<Bug size={20} color={t.colors.textSecondary} />} onPress={() => router.push('/diagnostics')} />
          ) : null}
          <ListRow
            title={tr('common.logout')}
            destructive
            left={<LogOut size={20} color={t.colors.danger} />}
            onPress={async () => {
              if (await confirm({ title: tr('common.logout'), message: tr('mobile.menu.logout_confirm'), destructive: true, confirmLabel: tr('common.logout') })) logout();
            }}
            chevron={false}
            last
          />
        </Group>
      </Section>
      <View style={{ alignItems: 'center', paddingVertical: t.spacing.md }}>
        <BrandLockup height={22} caption={devToolsEnabled ? `v${Constants.expoConfig?.version ?? ''} · ${isMock ? 'demo' : 'live'}` : `v${Constants.expoConfig?.version ?? ''}`} />
      </View>
    </Screen>
  );
}

function ListRowCard({ title, subtitle, email, onPress }: { title: string; subtitle: string; email: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Group>
      <ListRow title={title} subtitle={`${subtitle}\n${email}`} left={<Avatar name={title} size={48} />} onPress={onPress} last />
      <View style={{ height: 0, backgroundColor: t.colors.border }} />
    </Group>
  );
}
