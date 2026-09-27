"use client";

import { UsageMeter } from "@/features/billing/components/usage-meter";
import {
  useBillingAccess,
  useBillingOverview,
} from "@/features/billing/hooks/use-billing";

/** Inline meter for one feature key; renders nothing without access or data. */
export function MeterFor({
  keyName,
  className,
}: {
  keyName: string;
  className?: string;
}) {
  const { canRead } = useBillingAccess();
  const overview = useBillingOverview(canRead);
  const meter = overview.data?.meters.find((m) => m.key === keyName);
  if (!canRead || !meter || meter.kind !== "limit") return null;
  return <UsageMeter meter={meter} compact className={className} />;
}
