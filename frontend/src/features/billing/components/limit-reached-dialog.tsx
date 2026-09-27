"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { routes } from "@/config/routes";
import {
  useBillingAccess,
  useBillingOverview,
} from "@/features/billing/hooks/use-billing";
import { meterLabel } from "@/features/billing/lib";
import { formatQuantity } from "@/features/finance/lib/format";
import {
  subscribeLimitEvents,
  type LimitEventDetail,
} from "@/lib/api/limit-events";
import { useLocale } from "@/providers/locale-provider";

/**
 * Global upgrade prompt. Listens for LIMIT_REACHED / FEATURE_DISABLED events
 * emitted by the API client and shows the numbers the server returned.
 */
export function LimitReachedDialog({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead } = useBillingAccess();
  const overview = useBillingOverview(canRead);
  const [event, setEvent] = useState<LimitEventDetail | null>(null);

  useEffect(
    () =>
      subscribeLimitEvents((detail) => {
        // Plan-disabled modules show an inline lock card + toast instead.
        if (detail.code === "LIMIT_REACHED") setEvent(detail);
      }),
    [],
  );

  const meter = event?.feature
    ? overview.data?.meters.find((m) => m.key === event.feature)
    : undefined;
  const featureName = meter
    ? meterLabel(meter, locale)
    : (event?.feature ?? "");
  const disabled = event?.code === "FEATURE_DISABLED";

  return (
    <Dialog
      open={event !== null}
      onOpenChange={(open) => !open && setEvent(null)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {disabled ? t("billing.locked.title") : t("billing.limit.title")}
          </DialogTitle>
          <DialogDescription>
            {disabled
              ? t("billing.limit.feature_disabled")
              : t("billing.limit.body", {
                  feature: featureName,
                  limit: formatQuantity(event?.limit ?? 0, locale),
                  used: formatQuantity(event?.used ?? 0, locale),
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEvent(null)}>
            {t("billing.limit.close")}
          </Button>
          {canRead ? (
            <Button
              onClick={() => {
                setEvent(null);
                router.push(routes.tenant.settings.billing(slug));
              }}
            >
              {t("billing.limit.upgrade")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
