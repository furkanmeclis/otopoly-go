"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Fingerprint,
  KeyRound,
  Lock,
  Monitor,
  PlugZap,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { ChangePasswordForm } from "@/features/account/components/change-password-form";
import { DeleteAccountDialog } from "@/features/account/components/delete-account-dialog";
import { OAuthIdentityManager } from "@/features/account/components/github-identity-manager";
import { NotificationPreferencesForm } from "@/features/account/components/notification-preferences-form";
import { TenantNotificationPreferences } from "@/features/account/components/tenant-notification-preferences";
import { PasskeyManager } from "@/features/account/components/passkey-manager";
import { SessionManager } from "@/features/account/components/session-manager";
import { TotpManager } from "@/features/account/components/totp-manager";
import { ProfileEditForm } from "@/features/account/components/profile-edit-form";
import { ProfilePermissionsList } from "@/features/account/components/profile-permissions-list";
import { ConnectedAppsTable } from "@/features/mcp";
import { isApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { authService } from "@/services/auth.service";
import { fetchAppPublicConfig } from "@/services/app-config.service";
import { cn } from "@/lib/utils";

type AccountShell = "platform" | "cms" | "tenant";

const tabs = [
  { id: "account", labelKey: "auth.profile.tabs.account", icon: UserRound },
  { id: "security", labelKey: "auth.profile.tabs.security", icon: Lock },
  {
    id: "notifications",
    labelKey: "auth.profile.tabs.notifications",
    icon: Bell,
  },
  {
    id: "permissions",
    labelKey: "auth.profile.tabs.permissions",
    icon: KeyRound,
  },
  {
    id: "connected-apps",
    labelKey: "auth.profile.tabs.connected_apps",
    icon: PlugZap,
  },
] as const;

type ProfileTab = (typeof tabs)[number]["id"];

function isProfileTab(value: string): value is ProfileTab {
  return tabs.some((item) => item.id === value);
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function initials(fullName?: string) {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${a}${b}`.toUpperCase() || "U";
}

function homeHref(shell: AccountShell, tenantSlug?: string) {
  if (shell === "platform") return routes.platform.home;
  if (shell === "tenant" && tenantSlug) return routes.tenant.home(tenantSlug);
  return routes.cms.home;
}

export function AccountProfilePage({
  shell,
  tenantSlug,
}: {
  shell: AccountShell;
  tenantSlug?: string;
}) {
  const { t, locale } = useLocale();
  const { user, hydrateProfile } = useAuth();
  const { data: appConfig } = useQuery({
    queryKey: ["app", "config", locale],
    queryFn: () => fetchAppPublicConfig(locale),
  });

  const roles = user?.roles?.length
    ? user.roles
    : user?.isSuperAdmin
      ? ["super_admin"]
      : [];

  // The active section is mirrored in the URL hash (#security) so it
  // survives a reload and can be linked to without a Suspense boundary.
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  const [picked, setPicked] = useState<ProfileTab | null>(null);
  const tab: ProfileTab = picked ?? (isProfileTab(hash) ? hash : "account");
  const selectTab = (value: string) => {
    if (!isProfileTab(value)) return;
    setPicked(value);
    window.history.replaceState(null, "", `#${value}`);
  };

  const requestVerify = async () => {
    try {
      await authService.requestEmailVerify(user?.email);
      toast.success(t("auth.verify.request_success"));
    } catch (error) {
      if (isApiError(error)) {
        toast.error(error.message || t("common.error_generic"));
      } else {
        toast.error(t("common.error_generic"));
      }
    } finally {
      await hydrateProfile();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("auth.profile.title")}
        description={t("auth.profile.description")}
        breadcrumbs={[
          {
            label: t("layout.breadcrumb_home"),
            href: homeHref(shell, tenantSlug),
          },
          { label: t("auth.profile") },
        ]}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar className="size-14 shrink-0">
          <AvatarFallback className="text-base font-semibold">
            {initials(user?.fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-lg font-semibold">
            {user?.fullName || "—"}
          </p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 break-all">{user?.email || "—"}</span>
            {user?.emailVerified ? (
              <Badge variant="success">{t("auth.profile.verified")}</Badge>
            ) : (
              <>
                <Badge variant="warning">{t("auth.profile.unverified")}</Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={requestVerify}
                >
                  {t("auth.verify.request")}
                </Button>
              </>
            )}
          </div>
          {roles.length ? (
            <div className="flex flex-wrap gap-1.5">
              {roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        {/* Scrolls horizontally on narrow screens instead of wrapping. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {tabs.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="px-3">
                <item.icon aria-hidden />
                {t(item.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="account" className="mt-4 space-y-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{t("auth.profile.edit_title")}</CardTitle>
              <CardHint>{t("auth.profile.edit_hint")}</CardHint>
            </CardHeader>
            <CardContent>
              <ProfileEditForm />
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Fact
                  label={t("auth.profile.status")}
                  value={
                    user?.status ? (
                      <Badge variant="secondary">{user.status}</Badge>
                    ) : (
                      "—"
                    )
                  }
                />
                <Fact
                  label={t("auth.profile.uuid")}
                  value={
                    <span className="font-mono text-xs">
                      {user?.uuid ?? "—"}
                    </span>
                  }
                />
              </dl>
            </CardContent>
          </Card>

          <Card className="border-destructive/40 shadow-none">
            <CardHeader>
              <CardTitle>{t("auth.delete_account.title")}</CardTitle>
              <CardHint>{t("auth.delete_account.description")}</CardHint>
            </CardHeader>
            <CardContent>
              <DeleteAccountDialog />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>{t("auth.password.title")}</CardTitle>
                <CardHint>{t("auth.profile.change_password_body")}</CardHint>
              </CardHeader>
              <CardContent>
                <ChangePasswordForm />
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck
                    className="text-muted-foreground size-5"
                    aria-hidden
                  />
                  {t("auth.totp.title")}
                </CardTitle>
                <CardHint>{t("auth.totp.description")}</CardHint>
              </CardHeader>
              <CardContent>
                <TotpManager />
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Fingerprint
                    className="text-muted-foreground size-5"
                    aria-hidden
                  />
                  {t("auth.passkey.title")}
                </CardTitle>
                <CardHint>{t("auth.passkey.description")}</CardHint>
              </CardHeader>
              <CardContent>
                <PasskeyManager />
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>{t("auth.oauth.title")}</CardTitle>
                <CardHint>{t("auth.oauth.profile_hint")}</CardHint>
              </CardHeader>
              <CardContent>
                <OAuthIdentityManager
                  providers={[
                    {
                      id: "github",
                      enabled: Boolean(appConfig?.auth_methods.github.login),
                    },
                    {
                      id: "google",
                      enabled: Boolean(appConfig?.auth_methods.google.login),
                    },
                    {
                      id: "facebook",
                      enabled: Boolean(appConfig?.auth_methods.facebook.login),
                    },
                    {
                      id: "apple",
                      enabled: Boolean(appConfig?.auth_methods.apple.login),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="text-muted-foreground size-5" aria-hidden />
                {t("auth.sessions.title")}
              </CardTitle>
              <CardHint>{t("auth.sessions.description")}</CardHint>
            </CardHeader>
            <CardContent>
              <SessionManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4 space-y-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{t("auth.preferences.title")}</CardTitle>
              <CardHint>{t("auth.preferences.description")}</CardHint>
            </CardHeader>
            <CardContent>
              <NotificationPreferencesForm />
            </CardContent>
          </Card>

          {shell === "tenant" && tenantSlug ? (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>{t("messaging.prefs.title")}</CardTitle>
                <CardHint>{t("messaging.prefs.description")}</CardHint>
              </CardHeader>
              <CardContent>
                <TenantNotificationPreferences />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="connected-apps" className="mt-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{t("mcp.grants.title")}</CardTitle>
              <CardHint>{t("mcp.grants.description")}</CardHint>
            </CardHeader>
            <CardContent>
              {tab === "connected-apps" ? <ConnectedAppsTable /> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="mt-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{t("auth.profile.permissions_title")}</CardTitle>
              <CardHint>{t("auth.profile.permissions_hint")}</CardHint>
            </CardHeader>
            <CardContent>
              <ProfilePermissionsList granted={user?.permissions} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CardHint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-muted-foreground text-sm", className)}>{children}</p>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-sm font-medium break-all">{value}</dd>
    </div>
  );
}
