import type { ReactNode } from 'react';

import { ModuleGate } from '@/features/billing/components/module-gate';
import { useReviewSummary } from '@/features/reviews/queries';

/** `reviews.enabled` lock: the summary is behind the same `RequireFeature` middleware as every review route. */
export function ReviewsModuleGate({ title, children }: { title: string; children: ReactNode }) {
  const probe = useReviewSummary(30);
  return (
    <ModuleGate feature="reviews.enabled" title={title} probe={probe}>
      {children}
    </ModuleGate>
  );
}
