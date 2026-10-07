"use client";

import { useMemo, useState } from "react";
import { FileText, Lock, Pencil } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageTemplateEditor } from "@/features/messaging/components/message-template-editor";
import { useTemplateCatalog } from "@/features/messaging/hooks/use-message-templates";
import { renderTemplate, typeKey } from "@/features/messaging/lib/render";
import type {
  MessageTemplateType,
  TemplateChannel,
} from "@/features/messaging/services/templates.service";
import { useLocale } from "@/providers/locale-provider";

export function MessageTemplatesPanel({
  canWrite: canWriteRole,
  ownNumberEntitled = true,
}: {
  canWrite: boolean;
  /**
   * Plan feature `whatsapp.own_number`. Without it every message goes from
   * the platform number with the platform templates, so the editor is
   * read-only.
   */
  ownNumberEntitled?: boolean;
}) {
  const { t, locale } = useLocale();
  const canWrite = canWriteRole && ownNumberEntitled;
  const catalog = useTemplateCatalog();
  const [editing, setEditing] = useState<{
    type: string;
    channel?: TemplateChannel;
  } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, MessageTemplateType[]>();
    for (const type of catalog.data ?? []) {
      const list = map.get(type.group) ?? [];
      list.push(type);
      map.set(type.group, list);
    }
    return [...map.entries()];
  }, [catalog.data]);

  const editingType =
    catalog.data?.find((x) => x.type === editing?.type) ?? null;
  const loc = locale === "en" ? "en" : "tr";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          {t("messaging.templates.title")}
        </CardTitle>
        <CardDescription>
          {t("messaging.templates.description")}
          {!canWriteRole ? ` ${t("messaging.templates.read_only")}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!ownNumberEntitled ? (
          <div className="bg-muted/50 flex items-start gap-3 rounded-md border p-3 text-sm">
            <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">
                {t("messaging.templates.platform_title")}
              </p>
              <p className="text-muted-foreground">
                {t("messaging.templates.platform_body")}
              </p>
            </div>
          </div>
        ) : null}
        {catalog.isLoading ? (
          <div
            className="space-y-2"
            aria-label={t("messaging.templates.loading")}
          >
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : catalog.isError ? (
          <ErrorState
            title={t("messaging.templates.error")}
            onRetry={() => void catalog.refetch()}
            retryLabel={t("messaging.templates.retry")}
          />
        ) : groups.length === 0 ? (
          <EmptyState title={t("messaging.templates.empty")} />
        ) : (
          groups.map(([group, types]) => (
            <section key={group} className="space-y-2">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t(`messaging.group.${group}`)}
              </h3>
              <div className="divide-y rounded-xl border">
                {types.map((type) => {
                  const first = type.templates.find(
                    (e) => e.locale === loc && e.channel === type.channels[0],
                  );
                  const samples = Object.fromEntries(
                    type.placeholders.map((p) => [
                      p.key,
                      loc === "en" ? p.sample_en : p.sample_tr,
                    ]),
                  );
                  return (
                    <div
                      key={type.type}
                      className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {t(`messaging.types.${typeKey(type.type)}`)}
                          </span>
                          <Badge variant="secondary" className="text-[11px]">
                            {t(`messaging.audience.${type.audience}`)}
                          </Badge>
                        </div>
                        {first ? (
                          <p className="text-muted-foreground line-clamp-1 text-xs break-all whitespace-pre-wrap">
                            {renderTemplate(first.body, samples)}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-1">
                          {type.channels.map((ch) => {
                            const e = type.templates.find(
                              (x) => x.channel === ch && x.locale === loc,
                            );
                            return (
                              <button
                                key={ch}
                                type="button"
                                onClick={() =>
                                  setEditing({ type: type.type, channel: ch })
                                }
                                className="rounded-md"
                              >
                                <Badge
                                  variant={
                                    e && !e.is_active ? "outline" : "default"
                                  }
                                  className="cursor-pointer text-[11px]"
                                >
                                  {t(`messaging.channel.${ch}`)}
                                  {e && !e.is_active
                                    ? ` · ${t("messaging.badge.passive")}`
                                    : e?.is_custom
                                      ? ` · ${t("messaging.badge.custom")}`
                                      : ""}
                                </Badge>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start sm:self-center"
                        onClick={() => setEditing({ type: type.type })}
                      >
                        <Pencil className="size-3.5" />
                        {t("messaging.templates.edit")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </CardContent>

      <MessageTemplateEditor
        type={editingType}
        initialChannel={editing?.channel}
        canWrite={canWrite}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Card>
  );
}
