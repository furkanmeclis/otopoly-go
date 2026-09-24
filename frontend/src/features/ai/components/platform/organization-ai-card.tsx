"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EntitySectionCard } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { permissions } from "@/config/permissions";
import { aiKeys } from "@/features/ai/hooks/query-keys";
import { aiPlatformService } from "@/features/ai/services/ai.service";
import type { AIOrgSettings } from "@/features/ai/types";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { appToast } from "@/providers/toast-provider";

function OrgAIForm({
  uuid,
  data,
  canWrite,
}: {
  uuid: string;
  data: AIOrgSettings;
  canWrite: boolean;
}) {
  const { t, locale } = useLocale();
  const qc = useQueryClient();
  const nf = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US");
  const [enabled, setEnabled] = useState(data.enabled);
  const [quota, setQuota] = useState(
    data.monthly_token_quota == null ? "" : String(data.monthly_token_quota),
  );

  const mutation = useMutation({
    mutationFn: () =>
      aiPlatformService.putOrgSettings(uuid, {
        enabled,
        monthly_token_quota: quota.trim() === "" ? null : Number(quota),
      }),
    onSuccess: (next) => {
      qc.setQueryData(aiKeys.org(uuid), next);
      appToast.success(t("ai.org.saved"));
    },
    onError: (error) =>
      appToast.error(isApiError(error) ? error.message : t("ai.org.failed")),
  });

  const q = data.quota;
  const percent = q.unlimited || q.limit === 0 ? 0 : (q.used / q.limit) * 100;
  const quotaValid = quota.trim() === "" || /^\d+$/.test(quota.trim());

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="org-ai-enabled">{t("ai.org.enabled")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("ai.org.enabled_hint")}
          </p>
        </div>
        <Switch
          id="org-ai-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!canWrite || mutation.isPending}
        />
      </div>
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="org-ai-quota">{t("ai.org.quota")}</Label>
        <Input
          id="org-ai-quota"
          inputMode="numeric"
          value={quota}
          onChange={(e) => setQuota(e.target.value)}
          placeholder={t("ai.org.quota_placeholder")}
          disabled={!canWrite || mutation.isPending}
          aria-invalid={!quotaValid}
        />
        <p className="text-muted-foreground text-xs">
          {t("ai.org.quota_hint", {
            default:
              data.default_quota === 0
                ? t("ai.usage.unlimited")
                : nf.format(data.default_quota),
          })}
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm">
          {q.unlimited
            ? t("ai.org.usage_unlimited", { used: nf.format(q.used) })
            : t("ai.org.usage", {
                used: nf.format(q.used),
                limit: nf.format(q.limit),
              })}
        </p>
        {!q.unlimited ? <Progress value={Math.min(100, percent)} /> : null}
      </div>
      {canWrite ? (
        <Button
          type="button"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !quotaValid}
        >
          {mutation.isPending ? t("common.loading") : t("ai.org.save")}
        </Button>
      ) : null}
    </div>
  );
}

/** Per-organization AI switch + quota, shown on the platform organization page. */
export function OrganizationAICard({ uuid }: { uuid: string }) {
  const { t } = useLocale();
  const { can } = usePermission();
  const canRead = can(permissions.ai.read);
  const { data, isLoading } = useQuery({
    queryKey: aiKeys.org(uuid),
    queryFn: () => aiPlatformService.getOrgSettings(uuid),
    enabled: canRead,
  });
  if (!canRead) return null;
  return (
    <EntitySectionCard title={t("ai.org.title")}>
      <p className="text-muted-foreground mb-4 text-sm">
        {t("ai.org.description")}
      </p>
      {isLoading || !data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <OrgAIForm
          key={`${data.enabled}-${data.monthly_token_quota ?? "d"}`}
          uuid={uuid}
          data={data}
          canWrite={can(permissions.ai.write)}
        />
      )}
    </EntitySectionCard>
  );
}
