"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { StatsCard } from "@/components/common/stats-card";
import { StatusChip } from "@/components/common/status-chip";
import { EntityDetail, EntitySectionCard } from "@/components/entity";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { routes } from "@/config/routes";
import { roleDisplayName } from "@/features/roles/lib/role-display";
import { StepUpGate } from "@/features/step-up-engine";
import { USER_STATUS_TONE } from "@/features/users/constants";
import type {
  PlatformUserOverview,
  UserAIUsage,
  UserStatus,
} from "@/features/users/services/users.service";
import { datetime, relativeDatetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type UserGeneralTabProps = {
  overview: PlatformUserOverview;
};

function statusTone(status: string) {
  return status in USER_STATUS_TONE
    ? USER_STATUS_TONE[status as UserStatus]
    : ("default" as const);
}

function YesNo({
  value,
  yes,
  no,
}: {
  value: boolean;
  yes: string;
  no: string;
}) {
  return (
    <StatusChip label={value ? yes : no} tone={value ? "success" : "default"} />
  );
}

/** Profile, sign-in summary, platform roles and AI usage of a user. */
export function UserGeneralTab({ overview }: UserGeneralTabProps) {
  const { t, locale } = useLocale();
  const { user, security, counts } = overview;
  const roles = user.roles ?? [];
  const when = (value: string | null | undefined): ReactNode =>
    value ? (
      <span title={datetime(value, undefined, locale)}>
        {relativeDatetime(value, locale)}
      </span>
    ) : (
      t("users.general.never")
    );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title={t("users.general.counts.organizations")}
          value={counts.organizations.toLocaleString(locale)}
        />
        <StatsCard
          title={t("users.general.counts.active_sessions")}
          value={counts.active_sessions.toLocaleString(locale)}
        />
        <StatsCard
          title={t("users.general.counts.push_devices")}
          value={counts.push_devices.toLocaleString(locale)}
        />
        <StatsCard
          title={t("users.general.counts.unread_notifications")}
          value={counts.unread_notifications.toLocaleString(locale)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <EntitySectionCard title={t("users.detail.profile")}>
          <EntityDetail
            sections={[
              {
                id: "profile",
                fields: [
                  {
                    key: "name",
                    label: t("users.fields.name"),
                    value: user.name,
                  },
                  {
                    key: "surname",
                    label: t("users.fields.surname"),
                    value: user.surname,
                  },
                  {
                    key: "email",
                    label: t("users.fields.email"),
                    value: user.email,
                  },
                  {
                    key: "status",
                    label: t("users.fields.status"),
                    value: (
                      <StatusChip
                        label={t(`users.status.${user.status}`)}
                        tone={statusTone(user.status)}
                      />
                    ),
                  },
                  {
                    key: "locale",
                    label: t("users.fields.locale"),
                    value: user.locale,
                  },
                  {
                    key: "uuid",
                    label: t("users.fields.uuid"),
                    value: <code className="text-xs">{user.uuid}</code>,
                  },
                ],
              },
            ]}
          />
        </EntitySectionCard>

        <EntitySectionCard title={t("users.general.security")}>
          <EntityDetail
            sections={[
              {
                id: "security",
                fields: [
                  {
                    key: "email_verified",
                    label: t("users.fields.email_verified"),
                    value: security.email_verified_at ? (
                      <span
                        title={datetime(
                          security.email_verified_at,
                          undefined,
                          locale,
                        )}
                      >
                        <StatusChip
                          label={t("users.verified.yes")}
                          tone="success"
                        />
                      </span>
                    ) : (
                      <StatusChip
                        label={t("users.verified.no")}
                        tone="warning"
                      />
                    ),
                  },
                  {
                    key: "two_factor",
                    label: t("users.general.two_factor"),
                    value: (
                      <YesNo
                        value={security.two_factor_enabled}
                        yes={t("users.general.enabled")}
                        no={t("users.general.disabled")}
                      />
                    ),
                  },
                  {
                    key: "passkeys",
                    label: t("users.general.passkeys"),
                    value: security.passkey_count.toLocaleString(locale),
                  },
                  {
                    key: "password_set",
                    label: t("users.general.password_set"),
                    value: (
                      <YesNo
                        value={security.password_set}
                        yes={t("users.general.yes")}
                        no={t("users.general.no")}
                      />
                    ),
                  },
                  {
                    key: "created_at",
                    label: t("users.general.created_at"),
                    value: when(security.created_at),
                  },
                  {
                    key: "last_login_at",
                    label: t("users.general.last_login_at"),
                    value: when(security.last_login_at),
                  },
                ],
              },
            ]}
          />
        </EntitySectionCard>
      </div>

      <EntitySectionCard title={t("users.detail.roles")}>
        <StepUpGate purpose="users.detail.roles">
          {roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("users.detail.roles_empty")}
            </p>
          ) : (
            <ul className="divide-border divide-y rounded-md border">
              {roles.map((role) => (
                <li
                  key={role.uuid}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <Link
                      href={routes.platform.roles.detail(role.uuid)}
                      className="text-sm font-medium hover:underline"
                    >
                      {roleDisplayName(role, t)}
                    </Link>
                    <p className="text-muted-foreground font-mono text-xs">
                      {role.slug}
                    </p>
                  </div>
                  {role.is_system ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t("roles.labels.system")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </StepUpGate>
      </EntitySectionCard>

      {overview.ai ? <UserAIUsageCard ai={overview.ai} /> : null}
    </div>
  );
}

/** The user's own assistant usage this period, against each org quota. */
function UserAIUsageCard({ ai }: { ai: UserAIUsage }) {
  const { t, locale } = useLocale();
  const number = (value: number) => value.toLocaleString(locale);

  return (
    <EntitySectionCard
      title={t("users.ai.title")}
      action={
        <span className="text-muted-foreground text-xs">
          {t("users.ai.period", {
            start: datetime(ai.period_start, "dd.MM.yyyy", locale),
            end: datetime(ai.period_end, "dd.MM.yyyy", locale),
          })}
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatsCard
            title={t("users.ai.conversations")}
            value={number(ai.conversation_count)}
          />
          <StatsCard title={t("users.ai.tokens")} value={number(ai.tokens)} />
        </div>
        {ai.organizations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("users.ai.empty")}</p>
        ) : (
          <ul className="divide-border divide-y rounded-md border">
            {ai.organizations.map((item) => {
              const pct = item.unlimited
                ? 0
                : Math.min(
                    100,
                    Math.round(
                      (item.quota_used / Math.max(1, item.quota_limit)) * 100,
                    ),
                  );
              return (
                <li
                  key={item.organization.uuid}
                  className="space-y-2 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={routes.platform.organizations.detail(
                        item.organization.uuid,
                      )}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.organization.name}
                    </Link>
                    {!item.enabled ? (
                      <StatusChip
                        label={t("users.ai.org_disabled")}
                        tone="default"
                      />
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("users.ai.user_share", {
                      conversations: number(item.conversation_count),
                      tokens: number(item.tokens),
                    })}
                  </p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>{t("users.ai.org_quota")}</span>
                      <span className="tabular-nums">
                        {item.unlimited
                          ? t("users.ai.quota_unlimited", {
                              used: number(item.quota_used),
                            })
                          : t("users.ai.quota_value", {
                              used: number(item.quota_used),
                              limit: number(item.quota_limit),
                            })}
                      </span>
                    </div>
                    {!item.unlimited ? <Progress value={pct} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </EntitySectionCard>
  );
}
