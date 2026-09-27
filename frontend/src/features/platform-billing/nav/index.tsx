"use client";

import { createNavAdornment, type NavAdornment } from "@/features/nav-engine";
import {
  usePlatformBillingAccess,
  usePlatformOrdersSummary,
} from "@/features/platform-billing/hooks/use-platform-billing";

function usePaymentsNavAdornment(): NavAdornment {
  const { canRead } = usePlatformBillingAccess();
  const { data } = usePlatformOrdersSummary(canRead);
  return {
    badges: [
      { kind: "count", value: data?.payment_reported ?? 0, variant: "warning" },
    ],
  };
}

export const PaymentsNavAdornment = createNavAdornment(usePaymentsNavAdornment);
