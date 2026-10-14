"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { routes } from "@/config/routes";
import { useTenant } from "@/features/organizations/providers/tenant-provider";
import { useAuthStore } from "@/lib/auth/session-store";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

export function TenantRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { slug, organization } = useTenant();
  const { bootstrapped, isAuthenticated, user } = useAuth();
  const { t } = useLocale();
  const cachedUser = useAuthStore((s) => s.user);

  const membership = user?.organizations.find((org) => org.slug === slug);
  const [nowMs] = useState(() => Date.now());
  const accessExpired =
    membership?.access_ends_at &&
    new Date(membership.access_ends_at).getTime() <= nowMs;

  useEffect(() => {
    if (!bootstrapped) return;
    if (!isAuthenticated) {
      // Sign in at the business login and come back to this page.
      router.replace(
        routes.public.loginWithNext(pathname || routes.tenant.home(slug)),
      );
    }
  }, [bootstrapped, isAuthenticated, pathname, router, slug]);

  // Show loading only when there is no cached user to render optimistically.
  // If cachedUser exists, render children immediately and let session
  // verification update state in the background.
  if (!bootstrapped && !cachedUser) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        {t("common.loading")}
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!membership) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("organizations.access.denied_title")}</CardTitle>
            <CardDescription>
              {t("organizations.access.denied_description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={routes.public.root}>
                {t("organizations.access.back_home")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accessExpired) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("organizations.access.expired_title")}</CardTitle>
            <CardDescription>
              {t("organizations.access.expired_description", {
                name: organization?.name ?? slug,
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return children;
}
