"use client";

import { EmptyState } from "@/components/common/empty-state";
import { StatsCard } from "@/components/common/stats-card";
import { StatusChip } from "@/components/common/status-chip";
import { EntityDetail, EntitySectionCard } from "@/components/entity";
import { OutboundLogCard } from "@/features/messaging/components/outbound-log-card";
import { organizationsKeys } from "@/features/organizations/hooks/query-keys";
import {
  organizationsService,
  type OrganizationWhatsAppOverview,
} from "@/features/organizations/services/organizations.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type OrganizationWhatsAppTabProps = {
  organizationUuid: string;
  whatsapp: OrganizationWhatsAppOverview | null | undefined;
};

const SESSION_TONE = {
  connected: "success",
  qr_pending: "warning",
  error: "danger",
  disconnected: "default",
} as const;

/** Own-number session, fallback setting, 30-day totals and the outbound log. */
export function OrganizationWhatsAppTab({
  organizationUuid,
  whatsapp,
}: OrganizationWhatsAppTabProps) {
  const { t, locale } = useLocale();

  if (!whatsapp) {
    return <EmptyState title={t("organizations.whatsapp.unavailable")} />;
  }
  const { session, outbound } = whatsapp;
  const yesNo = (value: boolean) =>
    value ? t("organizations.whatsapp.yes") : t("organizations.whatsapp.no");

  return (
    <div className="space-y-6">
      <EntitySectionCard title={t("organizations.whatsapp.session")}>
        <EntityDetail
          sections={[
            {
              id: "session",
              fields: [
                {
                  key: "status",
                  label: t("organizations.whatsapp.status"),
                  value: (
                    <StatusChip
                      label={t(
                        `organizations.whatsapp.session_status.${session.status}`,
                      )}
                      tone={SESSION_TONE[session.status]}
                    />
                  ),
                },
                {
                  key: "phone",
                  label: t("organizations.whatsapp.phone"),
                  value: session.phone_number
                    ? `+${session.phone_number}${
                        session.display_name ? ` · ${session.display_name}` : ""
                      }`
                    : "—",
                },
                {
                  key: "last_seen_at",
                  label: t("organizations.whatsapp.last_seen_at"),
                  value: session.last_seen_at
                    ? datetime(session.last_seen_at, undefined, locale)
                    : "—",
                },
                {
                  key: "own_number_entitled",
                  label: t("organizations.whatsapp.own_number_entitled"),
                  value: yesNo(session.own_number_entitled),
                },
                {
                  key: "fallback",
                  label: t("organizations.whatsapp.fallback"),
                  value: yesNo(session.fallback_to_platform),
                },
                {
                  key: "platform_sender",
                  label: t("organizations.whatsapp.platform_sender"),
                  value: session.platform_sender_available
                    ? t("messaging.wa.platform_available")
                    : t("messaging.wa.platform_unavailable"),
                },
                ...(session.error_message
                  ? [
                      {
                        key: "error",
                        label: t("organizations.whatsapp.error"),
                        value: (
                          <span className="text-destructive">
                            {session.error_message}
                          </span>
                        ),
                      },
                    ]
                  : []),
              ],
            },
          ]}
        />
      </EntitySectionCard>

      <div>
        <h3 className="mb-3 text-sm font-medium">
          {t("organizations.whatsapp.last_30_days")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatsCard
            title={t("organizations.whatsapp.totals.total")}
            value={outbound.total}
            hint={
              outbound.last_at
                ? t("organizations.whatsapp.totals.last_at", {
                    date: datetime(outbound.last_at, undefined, locale),
                  })
                : undefined
            }
          />
          <StatsCard
            title={t("organizations.whatsapp.totals.delivered")}
            value={outbound.delivered}
          />
          <StatsCard
            title={t("organizations.whatsapp.totals.failed")}
            value={outbound.failed}
          />
          <StatsCard
            title={t("organizations.whatsapp.totals.own_number")}
            value={outbound.own_number}
          />
          <StatsCard
            title={t("organizations.whatsapp.totals.platform")}
            value={outbound.platform}
          />
        </div>
      </div>

      <OutboundLogCard
        description={t("organizations.whatsapp.outbound_description")}
        source={{
          queryKey: (params) =>
            organizationsKeys.outbound(organizationUuid, params),
          fetchPage: (params) =>
            organizationsService.outbound(organizationUuid, params),
        }}
      />
    </div>
  );
}
