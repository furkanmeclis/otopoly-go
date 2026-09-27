"use client";

import { AlertTriangle, Clock, Info, Lock, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { routes } from "@/config/routes";
import {
  useBillingAccess,
  useBillingOverview,
} from "@/features/billing/hooks/use-billing";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const DISMISS_KEY = "otopoly:billing-banner-dismissed";
const DAY = 24 * 60 * 60 * 1000;

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * Top-of-page subscription notice: ending soon, grace period, read-only,
 * or a payment under review. Read-only cannot be dismissed.
 */
export function SubscriptionBanner({ slug }: { slug: string }) {
  const { t } = useLocale();
  const { canRead } = useBillingAccess();
  const overview = useBillingOverview(canRead);
  const [dismissed, setDismissed] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readDismissed(),
  );
  const [now] = useState(() => Date.now());
  const data = overview.data;
  const sub = data?.subscription;
  if (!sub) return null;

  let tone: "amber" | "red" | "blue" | null = null;
  let text = "";
  let Icon = Info;
  if (sub.status === "read_only") {
    tone = "red";
    Icon = Lock;
    text = t("billing.banner.read_only");
  } else if (sub.status === "grace") {
    tone = "red";
    Icon = AlertTriangle;
    const left = sub.grace_ends_at
      ? Math.max(
          0,
          Math.ceil((new Date(sub.grace_ends_at).getTime() - now) / DAY),
        )
      : 0;
    text = t("billing.banner.grace", { days: left });
  } else if (data.open_order?.status === "payment_reported") {
    tone = "blue";
    Icon = Info;
    text = t("billing.banner.payment_reported");
  } else if (sub.days_left > 0 && sub.days_left <= 7) {
    tone = "amber";
    Icon = Clock;
    text = t(
      sub.status === "trial"
        ? "billing.banner.ending_trial"
        : "billing.banner.ending",
      {
        days: sub.days_left,
      },
    );
  }
  if (!tone) return null;
  const key = `${sub.uuid}:${sub.status}:${tone}`;
  const canDismiss = sub.status !== "read_only";
  if (canDismiss && dismissed === key) return null;

  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        tone === "red" &&
          "border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-200",
        tone === "amber" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
        tone === "blue" &&
          "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">
        {text}{" "}
        <Link
          href={routes.tenant.settings.billing(slug)}
          className="font-medium underline underline-offset-2"
        >
          {t("billing.banner.cta")}
        </Link>
      </p>
      {canDismiss ? (
        <button
          type="button"
          aria-label={t("billing.banner.dismiss")}
          className="opacity-70 hover:opacity-100"
          onClick={() => {
            setDismissed(key);
            try {
              window.sessionStorage.setItem(DISMISS_KEY, key);
            } catch {
              /* storage blocked — dismiss only for this render tree */
            }
          }}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
