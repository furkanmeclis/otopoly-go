import type { ReactNode } from 'react';

import { isFeatureDisabled } from '@/api/errors';
import { Header, Screen } from '@/components/ui';
import { FeatureLockedState } from '@/features/billing/components/feature-locked';
import type { LockedModule } from '@/features/billing/lib';
import { useLeadsSummary, useQuotesSummary } from '@/features/queries';

/**
 * Screen-level `403 FEATURE_DISABLED` guard for a plan module. `probe` is a cheap, cached query
 * behind the same `RequireFeature` middleware as the screen (backend checks the feature before
 * the permission), so its error tells whether the module is off before the screen's own calls fail.
 */
export function ModuleGate({ feature, title, probe, children }: { feature: LockedModule; title: string; probe: { error: unknown }; children: ReactNode }) {
  if (isFeatureDisabled(probe.error)) {
    return (
      <Screen header={<Header title={title} />}>
        <FeatureLockedState feature={feature} />
      </Screen>
    );
  }
  return <>{children}</>;
}

/**
 * Quotes and leads share `module.quotes` (backend quotes/leads `routes.go`). Probes the summary the
 * list screens, the menu badges and the dashboard already load.
 */
export function QuotesModuleGate({ area, title, children }: { area: 'quotes' | 'leads'; title: string; children: ReactNode }) {
  const quotes = useQuotesSummary(area === 'quotes');
  const leads = useLeadsSummary(area === 'leads');
  return (
    <ModuleGate feature="module.quotes" title={title} probe={area === 'quotes' ? quotes : leads}>
      {children}
    </ModuleGate>
  );
}
