"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Scale } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { PageHeader } from "@/components/layout/page-header";
import { Markdown } from "@/components/markdown/markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AppLocale } from "@/config/i18n";
import { permissions } from "@/config/permissions";
import {
  LEGAL_MAX_MARKDOWN_BYTES,
  formatLegalDate,
  privacyPath,
  utf8Bytes,
} from "@/features/legal/lib/legal";
import {
  legalService,
  type LegalPage,
  type LegalPagePatch,
} from "@/features/legal/services/legal.service";
import { isApiError } from "@/lib/api";
import { fileSize } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { appToast } from "@/providers/toast-provider";

type Draft = {
  title_tr: string;
  title_en: string;
  markdown_tr: string;
  markdown_en: string;
};

const LOCALES: AppLocale[] = ["tr", "en"];

function toDraft(page: LegalPage): Draft {
  return {
    title_tr: page.title_tr,
    title_en: page.title_en,
    markdown_tr: page.markdown_tr,
    markdown_en: page.markdown_en,
  };
}

/** Only the changed fields, so a save never overwrites untouched locales. */
function diff(page: LegalPage, draft: Draft): LegalPagePatch {
  const out: LegalPagePatch = {};
  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (draft[key] !== page[key]) out[key] = draft[key];
  }
  return out;
}

/** Platform editor for one legal page (TR/EN Markdown with live preview). */
export function LegalEditorPage({ slug }: { slug: "privacy" }) {
  const { t } = useLocale();
  const { can } = usePermission();
  const canWrite = can(permissions.legal.write);
  const queryKey = ["platform", "legal", slug] as const;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => legalService.get(slug),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Scale className="size-7" />}
        title={`${t("legal.editor.title")} · ${t("legal.editor.page_privacy")}`}
        description={t("legal.editor.description")}
        actions={
          <Button variant="outline" asChild>
            <a href={privacyPath("tr")} target="_blank" rel="noopener">
              <ExternalLink className="size-4" />
              {t("legal.editor.view_page")}
            </a>
          </Button>
        }
      />

      {isLoading ? <Loading label={t("common.loading")} /> : null}
      {isError ? (
        <ErrorState
          title={t("legal.editor.error.title")}
          description={t("legal.editor.error.description")}
          retryLabel={t("common.retry")}
          onRetry={() => refetch()}
        />
      ) : null}

      {data ? (
        // Remount on every saved version so the draft resets to it.
        <LegalEditor
          key={data.updated_at}
          page={data}
          slug={slug}
          canWrite={canWrite}
          queryKey={queryKey}
        />
      ) : null}
    </div>
  );
}

function LegalEditor({
  page,
  slug,
  canWrite,
  queryKey,
}: {
  page: LegalPage;
  slug: string;
  canWrite: boolean;
  queryKey: readonly unknown[];
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(page));
  const [tab, setTab] = useState<AppLocale>("tr");

  const patch = diff(page, draft);
  const dirty = Object.keys(patch).length > 0;
  const sizes = {
    tr: utf8Bytes(draft.markdown_tr),
    en: utf8Bytes(draft.markdown_en),
  };
  const tooLarge = LOCALES.some((l) => sizes[l] > LEGAL_MAX_MARKDOWN_BYTES);
  const missingTr = !draft.title_tr.trim() || !draft.markdown_tr.trim();

  const save = useMutation({
    mutationFn: () => legalService.patch(slug, patch),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      appToast.success(t("legal.editor.toast.saved"));
    },
    onError: (error) => {
      appToast.error(
        isApiError(error) ? error.message : t("legal.editor.toast.failed"),
      );
    },
  });

  const updated = formatLegalDate(page.updated_at, locale);
  const set = (key: keyof Draft) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-4">
      {!canWrite ? (
        <Alert>
          <AlertDescription>{t("legal.editor.read_only")}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as AppLocale)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="tr">{t("legal.editor.tab_tr")}</TabsTrigger>
            <TabsTrigger value="en">{t("legal.editor.tab_en")}</TabsTrigger>
          </TabsList>
          <p className="text-muted-foreground text-sm">
            {page.updated_by
              ? t("legal.editor.last_updated_by", {
                  date: updated,
                  name: page.updated_by.name || page.updated_by.email,
                })
              : t("legal.editor.last_updated", { date: updated })}
          </p>
        </div>

        {LOCALES.map((l) => {
          const titleKey = l === "tr" ? "title_tr" : "title_en";
          const bodyKey = l === "tr" ? "markdown_tr" : "markdown_en";
          const over = sizes[l] > LEGAL_MAX_MARKDOWN_BYTES;
          return (
            <TabsContent key={l} value={l} className="mt-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`legal-${titleKey}`}>
                        {t("legal.editor.field_title")}
                      </Label>
                      <Input
                        id={`legal-${titleKey}`}
                        value={draft[titleKey]}
                        onChange={(e) => set(titleKey)(e.target.value)}
                        maxLength={200}
                        readOnly={!canWrite}
                        lang={l}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <Label htmlFor={`legal-${bodyKey}`}>
                          {t("legal.editor.field_markdown")}
                        </Label>
                        <span
                          className={
                            over
                              ? "text-destructive text-xs tabular-nums"
                              : "text-muted-foreground text-xs tabular-nums"
                          }
                        >
                          {fileSize(sizes[l])} /{" "}
                          {fileSize(LEGAL_MAX_MARKDOWN_BYTES)}
                        </span>
                      </div>
                      <Textarea
                        id={`legal-${bodyKey}`}
                        value={draft[bodyKey]}
                        onChange={(e) => set(bodyKey)(e.target.value)}
                        readOnly={!canWrite}
                        spellCheck
                        lang={l}
                        aria-invalid={over || undefined}
                        className="min-h-[60vh] font-mono text-xs leading-relaxed"
                      />
                      <p className="text-muted-foreground text-xs">
                        {t("legal.editor.markdown_hint")}
                        {l === "en"
                          ? ` ${t("legal.editor.en_fallback_hint")}`
                          : null}
                      </p>
                      {over ? (
                        <p className="text-destructive text-xs">
                          {t("legal.editor.too_large", {
                            max: fileSize(LEGAL_MAX_MARKDOWN_BYTES),
                          })}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <p className="text-muted-foreground mb-4 text-xs font-medium tracking-wide uppercase">
                      {t("legal.editor.preview")}
                    </p>
                    {draft[bodyKey].trim() ? (
                      <div lang={l}>
                        <h2 className="font-display mb-6 text-2xl font-semibold tracking-tight">
                          {draft[titleKey] || draft.title_tr}
                        </h2>
                        <Markdown text={draft[bodyKey]} variant="document" />
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {t("legal.editor.preview_empty")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {canWrite ? (
        <div className="bg-background/95 sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t py-3">
          {missingTr ? (
            <p className="text-destructive mr-auto text-sm">
              {t("legal.editor.required")}
            </p>
          ) : dirty ? (
            <p className="text-muted-foreground mr-auto text-sm">
              {t("legal.editor.unsaved")}
            </p>
          ) : null}
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(toDraft(page))}
          >
            {t("legal.editor.reset")}
          </Button>
          <Button
            disabled={!dirty || tooLarge || missingTr || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t("legal.editor.saving") : t("legal.editor.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
