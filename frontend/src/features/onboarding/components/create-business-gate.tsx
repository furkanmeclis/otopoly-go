"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { routes } from "@/config/routes";
import { defaultHomeForUser, needsBusinessOnboarding } from "@/lib/auth/types";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

/**
 * Entry check for /onboarding/business: signed-out visitors go to login (the
 * server proxy does the same before render), users who already have a
 * business (or a platform role) go home. Decided once on arrival, so the
 * wizard's own redirect after creating the business is never overridden.
 */
export function CreateBusinessGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useLocale();
  const { bootstrapped, isAuthenticated, user } = useAuth();
  // Latched: once the user is let in, later profile changes (the business
  // this page creates) never trigger the redirect below.
  const [allowed, setAllowed] = useState(false);
  if (!allowed && bootstrapped && needsBusinessOnboarding(user)) {
    setAllowed(true);
  }

  useEffect(() => {
    if (allowed || !bootstrapped) return;
    if (!isAuthenticated) {
      router.replace(
        `/login?next=${encodeURIComponent(routes.onboarding.business)}`,
      );
      return;
    }
    // user === null: profile still loading.
    if (user && !needsBusinessOnboarding(user)) {
      router.replace(defaultHomeForUser(user));
    }
  }, [allowed, bootstrapped, isAuthenticated, router, user]);

  if (!allowed) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        {t("common.loading")}
      </div>
    );
  }
  return children;
}
