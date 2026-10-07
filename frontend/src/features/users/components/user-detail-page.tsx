"use client";

import {
  ArchiveRestore,
  KeyRound,
  Mail,
  Pencil,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRoundSearch,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PermissionGuard } from "@/components/common/permission-guard";
import { StatusChip } from "@/components/common/status-chip";
import { EntityActions, EntityHeader, EntityPage } from "@/components/entity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { UserActivityTab } from "@/features/users/components/user-activity-tab";
import { UserAuthMethodsIcons } from "@/features/users/components/user-auth-methods";
import { useUserDeleteFlow } from "@/features/users/components/user-delete-flow";
import { UserDevicesTab } from "@/features/users/components/user-devices-tab";
import { UserGeneralTab } from "@/features/users/components/user-general-tab";
import { UserNotificationsTab } from "@/features/users/components/user-notifications-tab";
import { UserOrganizationsTab } from "@/features/users/components/user-organizations-tab";
import { UserSessionsTab } from "@/features/users/components/user-sessions-tab";
import { UserSetPasswordDialog } from "@/features/users/components/user-set-password-dialog";
import {
  USER_DETAIL_TABS,
  USER_STATUS_TONE,
  type UserDetailTab,
} from "@/features/users/constants";
import {
  useDisableUser,
  useEnableUser,
  useImpersonateUser,
} from "@/features/users/hooks/use-user-mutations";
import {
  useUser,
  useUserOverview,
} from "@/features/users/hooks/use-users-query";
import { userFullName, userInitials } from "@/features/users/lib/user-display";
import type {
  PlatformUserDetail,
  UserStatus,
} from "@/features/users/services/users.service";
import { datetime } from "@/lib/utils/format";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type UserDetailPageProps = {
  uuid: string;
};

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm break-words">{value ?? "—"}</dd>
    </div>
  );
}

function isDetailTab(value: string | null): value is UserDetailTab {
  return (USER_DETAIL_TABS as readonly string[]).includes(value ?? "");
}

function statusTone(status: string) {
  if (status in USER_STATUS_TONE) {
    return USER_STATUS_TONE[status as UserStatus];
  }
  return "default" as const;
}

function UserDetailActions({
  user,
  onSetPassword,
  deleteFlow,
}: {
  user: PlatformUserDetail;
  onSetPassword: () => void;
  deleteFlow: ReturnType<typeof useUserDeleteFlow>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { can } = usePermission();
  const { user: currentUser } = useAuth();
  const enableUser = useEnableUser();
  const disableUser = useDisableUser();
  const impersonate = useImpersonateUser();
  const canImpersonate =
    can(permissions.users.impersonate) &&
    user.status === "active" &&
    user.uuid !== currentUser?.uuid &&
    !currentUser?.impersonation &&
    (!user.is_super_admin || Boolean(currentUser?.isSuperAdmin));

  // Deleted users are read-only until restored.
  if (user.deleted_at) {
    return (
      <EntityActions>
        <PermissionGuard permission={permissions.users.delete}>
          <Button
            type="button"
            size="sm"
            disabled={deleteFlow.isPending}
            onClick={() => void deleteFlow.requestRestore(user)}
          >
            <ArchiveRestore className="size-4" />
            {t("users.actions.restore")}
          </Button>
        </PermissionGuard>
      </EntityActions>
    );
  }

  return (
    <EntityActions>
      <PermissionGuard permission={permissions.users.write}>
        <Button
          type="button"
          size="sm"
          onClick={() => router.push(routes.platform.users.edit(user.uuid))}
        >
          <Pencil className="size-4" />
          {t("users.actions.edit")}
        </Button>
      </PermissionGuard>

      <PermissionGuard permission={permissions.users.write}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onSetPassword}
        >
          <KeyRound className="size-4" />
          {t("users.actions.set_password")}
        </Button>
      </PermissionGuard>

      {can(permissions.users.write) &&
      (user.status === "disabled" || user.status === "pending") ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={enableUser.isPending}
          onClick={() => enableUser.mutate(user.uuid)}
        >
          <ShieldCheck className="size-4" />
          {t("users.actions.enable")}
        </Button>
      ) : null}

      {can(permissions.users.write) && user.status === "active" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disableUser.isPending}
          onClick={() => disableUser.mutate(user.uuid)}
        >
          <ShieldOff className="size-4" />
          {t("users.actions.disable")}
        </Button>
      ) : null}

      {canImpersonate ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={impersonate.isPending}
          onClick={() => impersonate.mutate(user)}
        >
          <UserRoundSearch className="size-4" />
          {t("users.actions.impersonate")}
        </Button>
      ) : null}

      {can(permissions.users.delete) && user.uuid !== currentUser?.uuid ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={deleteFlow.isPending}
          onClick={() => void deleteFlow.requestDelete(user)}
        >
          <Trash2 className="size-4" />
          {t("users.actions.delete")}
        </Button>
      ) : null}
    </EntityActions>
  );
}

/**
 * Platform 360° user detail. Tabs are URL-synced (`?tab=`) so other screens
 * can deep-link, e.g. `/platform/users/{uuid}?tab=sessions`.
 */
export function UserDetailPage({ uuid }: UserDetailPageProps) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = usePermission();
  const userQuery = useUser(uuid);
  const deleteFlow = useUserDeleteFlow();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const canSeeTab = (value: UserDetailTab) => {
    if (value === "activity") return can(permissions.activity.read);
    if (value === "notifications") {
      // Without read_all the API would list the admin's own notifications.
      return (
        can(permissions.notifications.platformRead) &&
        can(permissions.notifications.platformReadAll)
      );
    }
    return true;
  };
  const tabParam = searchParams.get("tab");
  const tab: UserDetailTab =
    isDetailTab(tabParam) && canSeeTab(tabParam) ? tabParam : "general";
  const overview = useUserOverview(uuid, tab === "general");

  const user = userQuery.data;
  const title = user ? userFullName(user) : t("users.detail_title");

  const selectTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "general") params.delete("tab");
    else params.set("tab", next);
    // The organization filter only applies to the activity tab.
    if (next !== "activity") params.delete("org");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <EntityPage
      title={title}
      description={t("users.detail_description")}
      permission={permissions.users.read}
      forbiddenFallback={
        <ErrorState
          title={t("common.error_forbidden")}
          description={t("users.forbidden")}
        />
      }
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.platform.home },
        { label: t("users.title"), href: routes.platform.users.root },
        { label: title },
      ]}
      actions={
        user ? (
          <UserDetailActions
            user={user}
            onSetPassword={() => setPasswordOpen(true)}
            deleteFlow={deleteFlow}
          />
        ) : null
      }
    >
      {userQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {userQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("users.detail_not_found")}
          onRetry={() => void userQuery.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {user ? (
        <div className="space-y-6">
          {user.deleted_at ? (
            <Alert variant="destructive">
              <Trash2 />
              <AlertTitle>{t("users.detail.deleted_title")}</AlertTitle>
              <AlertDescription>
                {t("users.detail.deleted_description", {
                  date: datetime(user.deleted_at),
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          <EntityHeader
            title={userFullName(user)}
            badges={
              user.deleted_at ? (
                <StatusChip label={t("users.status.deleted")} tone="default" />
              ) : (
                <StatusChip
                  label={t(`users.status.${user.status}`)}
                  tone={statusTone(user.status)}
                />
              )
            }
            leading={
              <div className="bg-muted flex size-12 items-center justify-center rounded-lg">
                <span className="text-muted-foreground text-sm font-medium">
                  {userInitials(user)}
                </span>
              </div>
            }
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailField
                label={t("users.fields.email")}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="text-muted-foreground size-3.5 shrink-0" />
                    {user.email}
                  </span>
                }
              />
              <DetailField
                label={t("users.columns.auth_methods")}
                value={
                  (user.auth_methods ?? []).length > 0 ? (
                    <UserAuthMethodsIcons methods={user.auth_methods ?? []} />
                  ) : (
                    "—"
                  )
                }
              />
            </dl>
          </EntityHeader>

          <Tabs value={tab} onValueChange={selectTab}>
            <TabsList className="flex-wrap">
              {USER_DETAIL_TABS.filter(canSeeTab).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`users.tabs.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="general" className="mt-4">
              {overview.isLoading ? (
                <Loading label={t("common.loading")} />
              ) : overview.isError || !overview.data ? (
                <ErrorState
                  title={t("common.error_generic")}
                  description={t("users.detail.overview_error")}
                  onRetry={() => void overview.refetch()}
                  retryLabel={t("common.retry")}
                />
              ) : (
                <UserGeneralTab overview={overview.data} />
              )}
            </TabsContent>

            <TabsContent value="organizations" className="mt-4">
              <UserOrganizationsTab
                userUuid={user.uuid}
                userName={userFullName(user)}
                readOnly={Boolean(user.deleted_at)}
              />
            </TabsContent>

            <TabsContent value="sessions" className="mt-4">
              <UserSessionsTab user={user} />
            </TabsContent>

            <TabsContent value="devices" className="mt-4">
              <UserDevicesTab user={user} />
            </TabsContent>

            {canSeeTab("notifications") ? (
              <TabsContent value="notifications" className="mt-4">
                <UserNotificationsTab userUuid={user.uuid} />
              </TabsContent>
            ) : null}

            {canSeeTab("activity") ? (
              <TabsContent value="activity" className="mt-4">
                <UserActivityTab userUuid={user.uuid} />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      ) : null}

      <UserSetPasswordDialog
        open={passwordOpen}
        userUuid={user?.uuid ?? null}
        userLabel={user ? userFullName(user) : undefined}
        onOpenChange={setPasswordOpen}
      />
      {deleteFlow.dialog}
    </EntityPage>
  );
}
