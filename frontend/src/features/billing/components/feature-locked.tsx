"use client";

import { Lock } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { useLocale } from "@/providers/locale-provider";

/** Shown in place of a module's content when the plan turns it off (403 FEATURE_DISABLED). */
export function FeatureLocked({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <EmptyState
      className={className}
      title={t("billing.locked.title")}
      description={t("billing.locked.body")}
      action={
        <Button asChild>
          <Link href={routes.tenant.settings.billing(slug)}>
            <Lock className="size-4" />
            {t("billing.limit.upgrade")}
          </Link>
        </Button>
      }
    />
  );
}
