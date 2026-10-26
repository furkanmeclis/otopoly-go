"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { AppleIcon } from "@/components/icons/apple-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PermissionSlug } from "@/config/permissions";
import { ApnsKeyDialog } from "@/features/integrations/apns/components/apns-key-dialog";
import type { ApnsKeyFormValues } from "@/features/integrations/apns/schemas/apns-key-form";
import {
  apnsQueryKey,
  apnsService,
  type ApnsStatus,
  type ApnsTestResult,
} from "@/features/integrations/apns/services/apns.service";
import { isApiError } from "@/lib/api";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { appToast } from "@/providers/toast-provider";

const SOURCE_BADGE: Record<
  ApnsStatus["source"],
  { key: string; variant: "success" | "secondary" | "outline" }
> = {
  database: { key: "integrations.apns.source.database", variant: "success" },
  env: { key: "integrations.apns.source.env", variant: "secondary" },
  none: { key: "integrations.apns.source.none", variant: "outline" },
};

type ApnsKeyCardProps = {
  writePermission: PermissionSlug;
};

/** Platform → Entegrasyonlar → Apple: APNs key for iOS Live Activity pushes. */
export function ApnsKeyCard({ writePermission }: ApnsKeyCardProps) {
  const { t, locale } = useLocale();
  const { can } = usePermission();
  const canWrite = can(writePermission);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: apnsQueryKey,
    queryFn: apnsService.get,
  });

  const onApiError = (fallback: string) => (error: unknown) => {
    appToast.error(isApiError(error) ? error.message : t(fallback));
  };

  const saveMutation = useMutation({
    mutationFn: (values: ApnsKeyFormValues) =>
      apnsService.save({
        key_id: values.key_id.trim().toUpperCase(),
        team_id: values.team_id.trim().toUpperCase(),
        bundle_id: values.bundle_id.trim(),
        environment: values.environment,
        ...(values.private_key.trim()
          ? { private_key: values.private_key.trim() }
          : {}),
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(apnsQueryKey, status);
      setDialogOpen(false);
      appToast.success(t("integrations.apns.toast.saved"));
    },
    onError: onApiError("integrations.apns.toast.save_failed"),
  });

  const removeMutation = useMutation({
    mutationFn: apnsService.remove,
    onSuccess: (status) => {
      queryClient.setQueryData(apnsQueryKey, status);
      setConfirmRemove(false);
      appToast.success(t("integrations.apns.toast.removed"));
    },
    onError: onApiError("integrations.apns.toast.remove_failed"),
  });

  const testMutation = useMutation({
    mutationFn: apnsService.test,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: apnsQueryKey });
      if (result.ok) {
        appToast.success(t("integrations.apns.test.toast_ok"));
      } else {
        appToast.error(t(`integrations.apns.verdict.${result.verdict}`));
      }
    },
    onError: onApiError("integrations.apns.test.toast_failed"),
  });

  const badge = data ? SOURCE_BADGE[data.source] : null;
  const lastTest = testMutation.data ?? data?.last_test ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <AppleIcon className="size-5" />
              {t("integrations.apns.title")}
            </CardTitle>
            <CardDescription>
              {t("integrations.apns.description")}
            </CardDescription>
          </div>
          {badge ? <Badge variant={badge.variant}>{t(badge.key)}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {isLoading ? <Loading label={t("common.loading")} /> : null}
        {isError ? (
          <ErrorState
            title={t("integrations.apns.error.title")}
            description={t("integrations.apns.error.description")}
            retryLabel={t("common.retry")}
            onRetry={() => refetch()}
          />
        ) : null}

        {data ? (
          <>
            <Alert>
              <AlertDescription>
                {t("integrations.apns.guidance")}
              </AlertDescription>
            </Alert>

            {data.source === "env" ? (
              <p className="text-muted-foreground">
                {t("integrations.apns.env_hint")}
              </p>
            ) : null}
            {data.source === "none" ? (
              <p className="text-muted-foreground">
                {t("integrations.apns.none_hint")}
              </p>
            ) : null}

            {data.active ? (
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Detail
                  label={t("integrations.apns.field.key_id")}
                  value={data.active.key_id}
                  mono
                />
                <Detail
                  label={t("integrations.apns.field.team_id")}
                  value={
                    data.active.team_id
                      ? `${data.active.team_id}${
                          data.source === "database"
                            ? ` · ${t(`integrations.apns.team_source.${data.team_id_source}`)}`
                            : ""
                        }`
                      : "—"
                  }
                  mono
                />
                <Detail
                  label={t("integrations.apns.field.bundle_id")}
                  value={data.active.bundle_id}
                  mono
                />
                <Detail
                  label={t("integrations.apns.field.environment")}
                  value={t(
                    `integrations.apns.environment.${data.active.environment}`,
                  )}
                />
                <Detail
                  label={t("integrations.apns.field.fingerprint")}
                  value={data.active.key_fingerprint || "—"}
                  mono
                />
                <Detail
                  label={t("integrations.apns.field.uploaded_at")}
                  value={
                    data.source === "database" && data.uploaded_at
                      ? datetime(data.uploaded_at, "dd.MM.yyyy HH:mm", locale)
                      : "—"
                  }
                />
              </dl>
            ) : null}

            {lastTest ? <TestOutcome result={lastTest} /> : null}

            <div className="flex flex-wrap gap-2">
              {canWrite ? (
                <Button type="button" onClick={() => setDialogOpen(true)}>
                  <Upload className="size-4" />
                  {data.stored
                    ? t("integrations.apns.actions.edit")
                    : t("integrations.apns.actions.upload")}
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={data.source === "none" || testMutation.isPending}
                  onClick={() => testMutation.mutate()}
                >
                  {testMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlugZap className="size-4" />
                  )}
                  {t("integrations.apns.actions.test")}
                </Button>
              ) : null}
              {canWrite && data.stored ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="size-4" />
                  {t("integrations.apns.actions.remove")}
                </Button>
              ) : null}
            </div>

            <ApnsKeyDialog
              open={dialogOpen}
              status={data}
              isSaving={saveMutation.isPending}
              onOpenChange={setDialogOpen}
              onSubmit={async (values) => {
                await saveMutation.mutateAsync(values);
              }}
            />
            <ConfirmDialog
              open={confirmRemove}
              title={t("integrations.apns.remove.title")}
              description={
                data.env_configured
                  ? t("integrations.apns.remove.body_env")
                  : t("integrations.apns.remove.body")
              }
              confirmLabel={t("integrations.apns.actions.remove")}
              variant="destructive"
              isPending={removeMutation.isPending}
              onConfirm={() => removeMutation.mutate()}
              onCancel={() => setConfirmRemove(false)}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : undefined}>
        {value}
      </dd>
    </div>
  );
}

function TestOutcome({ result }: { result: ApnsTestResult }) {
  const { t, locale } = useLocale();
  const answer =
    result.status != null
      ? `${result.status}${result.reason ? ` ${result.reason}` : ""}`
      : result.error || "";
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {t("integrations.apns.test.last_result")}
        </span>
        <Badge variant={result.ok ? "success" : "danger"}>
          {result.ok
            ? t("integrations.apns.test.ok")
            : t("integrations.apns.test.failed")}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {datetime(result.tested_at, "dd.MM.yyyy HH:mm", locale)} ·{" "}
          {t(`integrations.apns.environment.${result.environment}`)} ·{" "}
          {t(`integrations.apns.source.${result.source}`)}
        </span>
      </div>
      <p>{t(`integrations.apns.verdict.${result.verdict}`)}</p>
      {answer ? (
        <p className="text-muted-foreground font-mono text-xs break-all">
          {t("integrations.apns.test.apns_answer", { answer })}
        </p>
      ) : null}
    </div>
  );
}
