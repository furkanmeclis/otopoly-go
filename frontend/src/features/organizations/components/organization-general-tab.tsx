"use client";

import { CalendarPlus, MapPin, Phone, Play, Pause } from "lucide-react";
import { useState } from "react";

import { StatusChip } from "@/components/common/status-chip";
import { EntityDetail, EntitySectionCard } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { permissions } from "@/config/permissions";
import { OrganizationExtendAccessDialog } from "@/features/organizations/components/organization-extend-access-dialog";
import { organizationStatusTone } from "@/features/organizations/constants";
import { useSetOrganizationStatus } from "@/features/organizations/hooks/use-organization-mutations";
import type { Organization } from "@/features/organizations/services/organizations.service";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

type OrganizationGeneralTabProps = {
  organization: Organization;
};

function accessExpired(organization: Organization) {
  return Boolean(
    organization.access_ends_at &&
    new Date(organization.access_ends_at) <= new Date(),
  );
}

/**
 * Profile + status / access window, with suspend / activate and extend
 * access (both step-up gated and audited by the API).
 */
export function OrganizationGeneralTab({
  organization,
}: OrganizationGeneralTabProps) {
  const { t } = useLocale();
  const { can } = usePermission();
  const { confirm, prompt } = useDialogs();
  const setStatus = useSetOrganizationStatus();
  const [extendOpen, setExtendOpen] = useState(false);
  const canWrite = can(permissions.organizations.write);
  const suspended = organization.status === "suspended";

  const toggleStatus = async () => {
    if (suspended) {
      const ok = await confirm({
        title: t("organizations.status_dialog.activate_title"),
        description: t("organizations.status_dialog.activate_description", {
          name: organization.name,
        }),
        confirmLabel: t("organizations.actions.activate"),
      });
      if (!ok) return;
      setStatus.mutate({
        uuid: organization.uuid,
        body: { status: "active" },
      });
      return;
    }
    const reason = await prompt({
      title: t("organizations.status_dialog.suspend_title"),
      description: t("organizations.status_dialog.suspend_description", {
        name: organization.name,
      }),
      placeholder: t("organizations.status_dialog.reason_placeholder"),
      confirmLabel: t("organizations.actions.suspend"),
    });
    if (reason === null) return;
    setStatus.mutate({
      uuid: organization.uuid,
      body: { status: "suspended", reason: reason.trim() },
    });
  };

  return (
    <div className="space-y-6">
      <EntitySectionCard
        title={t("organizations.detail.access")}
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!organization.access_ends_at}
                title={
                  organization.access_ends_at
                    ? undefined
                    : t("organizations.extend.unlimited_hint")
                }
                onClick={() => setExtendOpen(true)}
              >
                <CalendarPlus className="size-4" />
                {t("organizations.actions.extend_access")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={suspended ? "default" : "destructive"}
                disabled={setStatus.isPending}
                onClick={() => void toggleStatus()}
              >
                {suspended ? (
                  <Play className="size-4" />
                ) : (
                  <Pause className="size-4" />
                )}
                {suspended
                  ? t("organizations.actions.activate")
                  : t("organizations.actions.suspend")}
              </Button>
            </div>
          ) : null
        }
      >
        <EntityDetail
          sections={[
            {
              id: "access",
              fields: [
                {
                  key: "status",
                  label: t("organizations.fields.status"),
                  value: (
                    <StatusChip
                      label={t(`organizations.status.${organization.status}`)}
                      tone={organizationStatusTone(organization.status)}
                    />
                  ),
                },
                {
                  key: "plan_code",
                  label: t("organizations.fields.plan_code"),
                  value: organization.plan_code ?? "—",
                },
                {
                  key: "access_starts_at",
                  label: t("organizations.fields.access_starts_at"),
                  value: datetime(organization.access_starts_at),
                },
                {
                  key: "access_ends_at",
                  label: t("organizations.fields.access_ends_at"),
                  value: organization.access_ends_at ? (
                    <span
                      className={
                        accessExpired(organization)
                          ? "text-destructive"
                          : undefined
                      }
                    >
                      {datetime(organization.access_ends_at)}
                      {accessExpired(organization)
                        ? ` · ${t("organizations.detail.access_expired")}`
                        : ""}
                    </span>
                  ) : (
                    t("organizations.unlimited_access")
                  ),
                },
                {
                  key: "created_at",
                  label: t("organizations.fields.created_at"),
                  value: datetime(organization.created_at),
                },
              ],
            },
          ]}
        />
      </EntitySectionCard>

      <EntitySectionCard title={t("organizations.detail.profile")}>
        <EntityDetail
          sections={[
            {
              id: "profile",
              fields: [
                {
                  key: "city",
                  label: t("organizations.fields.city"),
                  value: organization.city || "—",
                },
                {
                  key: "district",
                  label: t("organizations.fields.district"),
                  value: organization.district || "—",
                },
                {
                  key: "phone",
                  label: t("organizations.fields.phone"),
                  value: organization.phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="text-muted-foreground size-3.5" />
                      {organization.phone}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                {
                  key: "address",
                  label: t("organizations.fields.address"),
                  value: organization.address ? (
                    <span className="inline-flex items-start gap-1.5">
                      <MapPin className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                      {organization.address}
                    </span>
                  ) : (
                    "—"
                  ),
                },
              ],
            },
          ]}
        />
      </EntitySectionCard>

      <OrganizationExtendAccessDialog
        organization={organization}
        open={extendOpen}
        onOpenChange={setExtendOpen}
      />
    </div>
  );
}
