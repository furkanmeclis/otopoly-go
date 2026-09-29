import { Tabs } from 'expo-router';
import { ClipboardList, LayoutDashboard, Menu, Users, Wallet } from 'lucide-react-native';

import { useAuth } from '@/features/auth/auth-provider';
import { P } from '@/features/auth/permissions';
import { useTodosSummary } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';
import { useTheme } from '@/theme/provider';

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useLocale();
  const { can } = useAuth();
  const todos = useTodosSummary(can(P.todosRead));
  const menuBadge = (todos.data?.overdue ?? 0) + (todos.data?.today ?? 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: { backgroundColor: theme.colors.tabBar, borderTopColor: theme.colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('mobile.tabs.home'), tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="operations"
        options={{
          title: t('mobile.tabs.operations'),
          href: can(P.jobsRead) ? undefined : null,
          tabBarIcon: ({ color, size }) => <ClipboardList size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: t('mobile.tabs.customers'),
          href: can(P.customersRead) ? undefined : null,
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{
          title: t('mobile.tabs.finance'),
          href: can(P.financeRead) ? undefined : null,
          tabBarIcon: ({ color, size }) => <Wallet size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: t('mobile.tabs.menu'),
          tabBarBadge: menuBadge > 0 ? menuBadge : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.colors.danger, fontSize: 10 },
          tabBarIcon: ({ color, size }) => <Menu size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
