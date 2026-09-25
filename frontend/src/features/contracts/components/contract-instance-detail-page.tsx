"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Trash2, UploadCloud } from "lucide-react";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityHeader,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiConfig } from "@/config/api";
import { routes } from "@/config/routes";
import { SignDialog } from "@/features/contracts/components/sign-dialog";
import {
  useContractInstance,
  useContractMutations,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import { contractsService } from "@/features/contracts/services/contracts.service";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { sanitizeRichHtml } from "@/lib/utils/sanitize-html";

function statusTone(status: string) {
  switch (status) {
    case "executed":
      return "success" as const;
    case "pending_signatures":
      return "warning" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

function mediaUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${apiConfig.baseUrl.replace(/\/$/, "")}${url}`;
}

export function ContractInstanceDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite, canManage } = useTenantContractsAccess(slug);
  const query = useContractInstance(uuid);
  const mutations = useContractMutations();
  const instance = query.data;
  const [signing, setSigning] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;
      const note = caption.trim() || undefined;
      void (async () => {
        for (const file of list) {
          await mutations.uploadMedia.mutateAsync({
            instanceUuid: uuid,
            file,
            caption: note,
          });
        }
        setCaption("");
        if (fileRef.current) fileRef.current.value = "";
      })();
    },
    [caption, mutations.uploadMedia, uuid],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("contracts.templates.forbidden")}
      />
    );
  }

  if (query.isLoading) {
    return <Loading label={t("common.loading")} />;
  }

  if (query.isError || !instance) {
    return (
      <ErrorState
        title={t("common.error_generic")}
        description={t("contracts.instances.error_description")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const canMutate =
    canWrite && instance.status !== "voided" && instance.status !== "executed";

  return (
    <EntityPage
      title={instance.title}
      description={t("contracts.instances.detail")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("contracts.instances.title"),
          href: routes.tenant.contracts.root(slug),
        },
        { label: instance.title },
      ]}
      actions={
        <EntityActions>
          {instance.status === "executed" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await contractsService.downloadPdf(uuid);
                } finally {
                  setDownloading(false);
                }
              }}
            >
              <Download className="size-4" />
              {t("contracts.instances.download_pdf")}
            </Button>
          ) : null}
          {canManage &&
          instance.status !== "voided" &&
          instance.status !== "executed" ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={mutations.voidInstance.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("contracts.instances.void"),
                  description: t("contracts.instances.void_confirm"),
                  confirmLabel: t("contracts.instances.void"),
                  variant: "destructive",
                });
                if (!ok) return;
                await mutations.voidInstance.mutateAsync(uuid);
              }}
            >
              {t("contracts.instances.void")}
            </Button>
          ) : null}
        </EntityActions>
      }
    >
      <div className="space-y-6">
        <EntityHeader
          title={instance.title}
          subtitle={
            instance.number_label
              ? `${t("contracts.fields.number")}: ${instance.number_label}`
              : instance.subject_type
          }
          badges={
            <StatusChip
              label={
                t(`contracts.instances.status.${instance.status}`) !==
                `contracts.instances.status.${instance.status}`
                  ? t(`contracts.instances.status.${instance.status}`)
                  : instance.status
              }
              tone={statusTone(instance.status)}
            />
          }
        >
          <p className="text-muted-foreground text-sm">
            {datetime(instance.created_at, "dd.MM.yyyy HH:mm", locale)}
          </p>
        </EntityHeader>

        <EntitySectionCard title={t("contracts.instances.preview")}>
          <div className="border-border from-card to-muted/30 overflow-hidden rounded-2xl border bg-gradient-to-b shadow-xs">
            <div className="from-primary via-primary/70 to-primary/40 h-1.5 bg-gradient-to-r" />
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 pb-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[0.65rem] font-semibold tracking-[0.12em] uppercase">
                  {t("contracts.instances.preview")}
                </p>
                <h2 className="text-foreground mt-1 text-xl font-semibold tracking-tight">
                  {instance.title}
                </h2>
              </div>
              <div className="bg-primary/8 border-primary/15 rounded-xl border px-3.5 py-2.5 text-right">
                <p className="text-muted-foreground text-[0.65rem] font-semibold tracking-wider uppercase">
                  {t("contracts.fields.number")}
                </p>
                <p className="text-primary font-mono text-sm font-semibold">
                  {instance.number_label || "—"}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {datetime(instance.created_at, "dd.MM.yyyy", locale)}
                </p>
              </div>
            </div>
            <div className="bg-primary mx-5 mb-4 h-0.5 w-14 rounded-full" />
            <div
              className="contract-preview prose prose-sm dark:prose-invert prose-headings:text-primary prose-headings:tracking-tight prose-ol:list-decimal prose-ul:list-disc prose-strong:text-foreground max-w-none px-5 pb-6"
              dangerouslySetInnerHTML={{
                __html: sanitizeRichHtml(instance.content_html),
              }}
            />
          </div>
        </EntitySectionCard>

        <EntitySectionCard
          title={t("contracts.instances.signers")}
          badge={instance.signers?.length ?? 0}
        >
          <ul className="divide-border divide-y text-sm">
            {(instance.signers ?? []).map((signer) => (
              <li
                key={signer.uuid}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-medium">
                    {signer.label}
                    {signer.suggested_name ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · {signer.suggested_name}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {signer.role}
                    {signer.required
                      ? ` · ${t("contracts.fields.required")}`
                      : ""}
                    {signer.otp_required
                      ? ` · ${
                          signer.otp_verified_at
                            ? t("contracts.otp.verified_short", {
                                phone: signer.otp_phone_masked ?? "",
                              })
                            : t("contracts.otp.required_short")
                        }`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip
                    label={
                      t(
                        `contracts.instances.signer_status.${signer.status}`,
                      ) !== `contracts.instances.signer_status.${signer.status}`
                        ? t(
                            `contracts.instances.signer_status.${signer.status}`,
                          )
                        : signer.status
                    }
                    tone={signer.status === "signed" ? "success" : "default"}
                  />
                  {canMutate && signer.status === "pending" ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setSigning(signer.uuid)}
                    >
                      {t("contracts.instances.sign")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </EntitySectionCard>

        <EntitySectionCard
          title={t("contracts.instances.gallery")}
          badge={instance.media?.length ?? 0}
        >
          <p className="text-muted-foreground mb-4 text-sm">
            {t("contracts.instances.gallery_help")}
          </p>

          {(instance.media?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground mb-3 text-sm">
              {t("contracts.instances.gallery_empty")}
            </p>
          ) : (
            <ul className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(instance.media ?? []).map((item) => {
                const src = mediaUrl(item.url);
                return (
                  <li
                    key={item.uuid}
                    className="border-border overflow-hidden rounded-md border"
                  >
                    {src && item.content_type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt={item.file_name}
                        className="h-36 w-full object-cover"
                      />
                    ) : (
                      <div className="bg-muted flex h-36 items-center justify-center p-3 text-center text-xs">
                        {item.file_name}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2 p-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.file_name}
                        </p>
                        {item.caption ? (
                          <p className="text-muted-foreground truncate text-xs">
                            {item.caption}
                          </p>
                        ) : null}
                      </div>
                      {canMutate ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={mutations.deleteMedia.isPending}
                          onClick={() =>
                            void mutations.deleteMedia.mutateAsync({
                              instanceUuid: uuid,
                              mediaUuid: item.uuid,
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canMutate ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="caption">
                  {t("contracts.instances.gallery_caption")}
                </Label>
                <Input
                  id="caption"
                  value={caption}
                  placeholder={t("contracts.instances.gallery_caption")}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </div>
              <div
                className={cn(
                  "relative cursor-pointer rounded-lg border border-dashed p-6 text-center transition-colors",
                  dragging && "border-primary bg-primary/5",
                  mutations.uploadMedia.isPending &&
                    "pointer-events-none opacity-60",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  uploadFiles(event.dataTransfer.files);
                }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="sr-only"
                  onChange={(e) => uploadFiles(e.target.files)}
                />
                <UploadCloud className="text-muted-foreground mx-auto mb-2 size-8" />
                <p className="font-medium">
                  {t("contracts.instances.gallery_drop_title")}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t("contracts.instances.gallery_drop_hint")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  disabled={mutations.uploadMedia.isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    fileRef.current?.click();
                  }}
                >
                  {t("contracts.instances.gallery_upload")}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("contracts.instances.gallery_locked")}
            </p>
          )}
        </EntitySectionCard>
      </div>

      <SignDialog
        open={Boolean(signing)}
        onOpenChange={(open) => {
          if (!open) setSigning(null);
        }}
        instance={instance}
        signerUuid={signing}
      />
    </EntityPage>
  );
}
