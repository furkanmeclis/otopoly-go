"use client";

import { Building2, ExternalLink, Pencil, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PermissionGuard } from "@/components/common/permission-guard";
import { StatusChip } from "@/components/common/status-chip";
import { EntityActions, EntityHeader, EntityPage } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiConfig } from "@/config/api";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { OrganizationAICard } from "@/features/ai";
import { OrganizationActivityTab } from "@/features/organizations/components/organization-activity-tab";
import { OrganizationGeneralTab } from "@/features/organizations/components/organization-general-tab";
import { OrganizationMembersTable } from "@/features/organizations/components/organization-members-table";
import { OrganizationStatsTab } from "@/features/organizations/components/organization-stats-tab";
import { OrganizationSubscriptionTab } from "@/features/organizations/components/organization-subscription-tab";
import { OrganizationWhatsAppTab } from "@/features/organizations/components/organization-whatsapp-tab";
import {
  ORGANIZATION_DETAIL_TABS,
  organizationStatusTone,
  type OrganizationDetailTab,
} from "@/features/organizations/constants";
import {
  useOrganization,
  useOrganizationOverview,
} from "@/features/organizations/hooks/use-organizations-query";
import type { OrganizationOverview } from "@/features/organizations/services/organizations.service";
import { useImpersonateUser } from "@/features/users/hooks/use-user-mutations";
import { userFullName } from "@/features/users/lib/user-display";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type OrganizationDetailPageProps = {
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

function isDetailTab(value: string | null): value is OrganizationDetailTab {
  return (ORGANIZATION_DETAIL_TABS as readonly string[]).includes(value ?? "");
}

/** Overview-backed tab body with shared loading / error states. */
function OverviewPanel({
  query,
  children,
}: {
  query: ReturnType<typeof useOrganizationOverview>;
  children: (overview: OrganizationOverview) => ReactNode;
}) {
  const { t } = useLocale();
  if (query.isLoading) return <Loading label={t("common.loading")} />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={t("common.error_generic")}
        description={t("organizations.detail.overview_error")}
        onRetry={() => void query.refetch()}
        retryLabel={t("common.retry")}
      />
    );
  }
  return <>{children(query.data)}</>;
}

/**
 * Platform 360° organization detail. Tabs are URL-synced (`?tab=`) so other
 * screens can deep-link, e.g. `/platform/organizations/{uuid}?tab=members`.
 */
export function OrganizationDetailPage({ uuid }: OrganizationDetailPageProps) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = usePermission();
  const query = useOrganization(uuid);
  const tabParam = searchParams.get("tab");
  const tab: OrganizationDetailTab = isDetailTab(tabParam)
    ? tabParam
    : "general";
  const needsOverview =
    tab === "subscription" || tab === "whatsapp" || tab === "stats";
  const overview = useOrganizationOverview(uuid, needsOverview);
  const impersonate = useImpersonateUser();

  const organization = query.data?.organization;
  const members = query.data?.members ?? [];
  const owner = members.find((member) => member.role === "owner");
  const title = organization?.name ?? t("organizations.detail_title");

  const logoSrc = organization?.logo_url
    ? `${apiConfig.baseUrl.replace(/\/$/, "")}${organization.logo_url}`
    : null;

  const selectTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "general") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <EntityPage
      title={title}
      description={t("organizations.detail_description")}
      permission={permissions.organizations.read}
      forbiddenFallback={
        <ErrorState
          title={t("common.error_forbidden")}
          description={t("organizations.forbidden")}
        />
      }
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.platform.home },
        {
          label: t("organizations.title"),
          href: routes.platform.organizations.root,
        },
        { label: title },
      ]}
      actions={
        organization ? (
          <EntityActions>
            {can(permissions.users.impersonate) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!owner || impersonate.isPending}
                title={
                  owner
                    ? t("organizations.quick.impersonate_hint", {
                        name: userFullName(owner),
                      })
                    : t("organizations.quick.no_owner")
                }
                onClick={() => owner && impersonate.mutate(owner)}
              >
                <UserRoundCog className="size-4" />
                {t("organizations.quick.impersonate_owner")}
              </Button>
            ) : null}
            <Button asChild type="button" size="sm" variant="outline">
              <Link
                href={routes.tenant.home(organization.slug)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-4" />
                {t("organizations.quick.open_tenant")}
              </Link>
            </Button>
            <PermissionGuard permission={permissions.organizations.write}>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  router.push(
                    routes.platform.organizations.edit(organization.uuid),
                  )
                }
              >
                <Pencil className="size-4" />
                {t("organizations.actions.edit")}
              </Button>
            </PermissionGuard>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("organizations.detail_not_found")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {organization ? (
        <div className="space-y-6">
          <EntityHeader
            title={organization.name}
            badges={
              <StatusChip
                label={t(`organizations.status.${organization.status}`)}
                tone={organizationStatusTone(organization.status)}
              />
            }
            leading={
              logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={organization.name}
                  className="h-12 w-auto max-w-[160px] object-contain"
                />
              ) : (
                <div className="bg-muted flex size-12 items-center justify-center rounded-lg">
                  <Building2 className="text-muted-foreground size-5" />
                </div>
              )
            }
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailField
                label={t("organizations.fields.slug")}
                value={
                  <Link
                    href={routes.tenant.home(organization.slug)}
                    className="hover:underline"
                  >
                    /{organization.slug}
                  </Link>
                }
              />
              <DetailField
                label={t("organizations.fields.uuid")}
                value={<code className="text-xs">{organization.uuid}</code>}
              />
            </dl>
          </EntityHeader>

          <Tabs value={tab} onValueChange={selectTab}>
            <TabsList className="flex-wrap">
              {ORGANIZATION_DETAIL_TABS.map((value) =>
                value === "activity" &&
                !can(permissions.activity.read) ? null : (
                  <TabsTrigger key={value} value={value}>
                    {t(`organizations.tabs.${value}`)}
                  </TabsTrigger>
                ),
              )}
            </TabsList>

            <TabsContent value="general" className="mt-4 space-y-6">
              <OrganizationGeneralTab organization={organization} />
              <OrganizationAICard uuid={organization.uuid} />
            </TabsContent>

            <TabsContent value="members" className="mt-4">
              <OrganizationMembersTable
                organizationUuid={organization.uuid}
                members={members}
              />
            </TabsContent>

            <TabsContent value="subscription" className="mt-4">
              <OverviewPanel query={overview}>
                {(data) => (
                  <OrganizationSubscriptionTab
                    organization={organization}
                    billing={data.billing}
                  />
                )}
              </OverviewPanel>
            </TabsContent>

            <TabsContent value="whatsapp" className="mt-4">
              <OverviewPanel query={overview}>
                {(data) => (
                  <OrganizationWhatsAppTab
                    organizationUuid={organization.uuid}
                    whatsapp={data.whatsapp}
                  />
                )}
              </OverviewPanel>
            </TabsContent>

            <TabsContent value="stats" className="mt-4">
              <OverviewPanel query={overview}>
                {(data) => <OrganizationStatsTab stats={data.stats} />}
              </OverviewPanel>
            </TabsContent>

            {can(permissions.activity.read) ? (
              <TabsContent value="activity" className="mt-4">
                <OrganizationActivityTab organizationUuid={organization.uuid} />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      ) : null}
    </EntityPage>
  );
}
