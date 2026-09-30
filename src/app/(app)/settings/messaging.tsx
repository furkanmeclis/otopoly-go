import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Header, Screen, Segmented } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/guard';
import { P } from '@/features/auth/permissions';
import { DailySummaryCard } from '@/features/messaging/components/daily-summary-card';
import { NotificationRulesCard } from '@/features/messaging/components/rules-card';
import { TemplatesPanel } from '@/features/messaging/components/templates-panel';
import { VehicleAlertsCard } from '@/features/messaging/components/vehicle-alerts-card';
import { WhatsAppSessionCard } from '@/features/messaging/components/whatsapp-session-card';
import { qk } from '@/features/queries';
import { useLocale } from '@/lib/i18n/provider';

type Tab = 'connection' | 'templates';

/** Web `settings/messaging` (MessagingPage): connection & rules tab, templates tab. */
export default function MessagingScreen() {
  const { t: tr } = useLocale();
  return (
    <RequirePermission gate={P.messagingRead} title={tr('messaging.page.title')}>
      <Messaging />
    </RequirePermission>
  );
}

function Messaging() {
  const { t: tr } = useLocale();
  const { can } = useAuth();
  const qc = useQueryClient();
  // Same rule as web: owner membership AND tenant.messaging.write.
  const canWrite = can({ perm: P.messagingWrite, owner: true });
  const [tab, setTab] = useState<Tab>('connection');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: qk.messaging });
    setRefreshing(false);
  };

  return (
    <Screen header={<Header title={tr('messaging.page.title')} subtitle={tr('messaging.page.description')} />} refreshing={refreshing} onRefresh={() => void refresh()}>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'connection', label: tr('messaging.tabs.connection') },
          { value: 'templates', label: tr('messaging.tabs.templates') },
        ]}
      />
      {tab === 'connection' ? (
        <>
          <WhatsAppSessionCard canWrite={canWrite} />
          <NotificationRulesCard canWrite={canWrite} />
          {/* Owner-only: the summary contains revenue and cash balances. */}
          {canWrite ? <VehicleAlertsCard /> : null}
          {canWrite ? <DailySummaryCard /> : null}
        </>
      ) : (
        <TemplatesPanel canWrite={canWrite} />
      )}
    </Screen>
  );
}
