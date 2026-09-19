"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { authService } from "@/services/auth.service";

/**
 * Ensures the BFF session JWT carries organization scope (`oid`) for tenant APIs.
 * TODO(finance): Re-call switch after token refresh (oid is dropped on /v1/auth/refresh today).
 */
export function TenantOrganizationContext({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const { update } = useSession();
  // Keep update in a ref so the effect doesn't re-run every time the session
  // object is refreshed (NextAuth returns a new function reference after each
  // session update, which would create an infinite loop).
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  });

  const { bootstrapped, isAuthenticated, user } = useAuth();
  const [ready, setReady] = useState(false);

  const hasMembership = Boolean(
    user?.organizations.some((org) => org.slug === slug),
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!bootstrapped) return;
      if (!isAuthenticated || !hasMembership) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        await authService.switchOrganizationContext(slug);
        await updateRef.current();
      } catch {
        // TenantRouteGuard / API errors surface access issues.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  // update intentionally excluded: it's accessed via updateRef to prevent
  // an infinite re-render loop when NextAuth refreshes the session object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, hasMembership, isAuthenticated, slug]);

  if (!ready) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        {t("common.loading")}
      </div>
    );
  }

  return children;
}
