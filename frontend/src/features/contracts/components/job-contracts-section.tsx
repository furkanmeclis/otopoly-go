"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Download, FilePlus2, ImagePlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { StatusChip } from "@/components/common/status-chip";
import { EntitySectionCard } from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { routes } from "@/config/routes";
import { SignerSignForm } from "@/features/contracts/components/signer-sign-form";
import {
  contractKeys,
  useContractInstances,
  useContractMutations,
  useContractTemplates,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import {
  contractsService,
  type ContractInstance,
  type ContractSigner,
} from "@/features/contracts/services/contracts.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

function statusTone(status: string) {
  switch (status) {
    case "draft":
      return "default" as const;
    case "executed":
      return "success" as const;
    case "pending":
    case "pending_signatures":
      return "warning" as const;
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

// Mirrors the API upload cap (handler caps contract media bodies at 12 MB).
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

type PhotoDraft = { id: string; file: File; previewUrl: string };

function nextPendingSigner(instance: ContractInstance): ContractSigner | null {
  const signers = instance.signers ?? [];
  return (
    signers.find((s) => s.required && s.status !== "signed") ??
    signers.find((s) => s.status !== "signed") ??
    null
  );
}

export function JobContractsSection({
  slug,
  jobUuid,
}: {
  slug: string;
  jobUuid: string;
}) {
  const { t, locale } = useLocale();
  const { canRead, canWrite } = useTenantContractsAccess(slug);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [templateUuid, setTemplateUuid] = useState("");
  const [created, setCreated] = useState<ContractInstance | null>(null);
  const [downloadingUuid, setDownloadingUuid] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PhotoDraft[]>([]);
  const queryClient = useQueryClient();
  const mutations = useContractMutations();

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    },
    [],
  );

  const listParams = useMemo(
    () => ({
      subject_type: "service_job",
      subject_uuid: jobUuid,
      limit: 50,
      offset: 0,
    }),
    [jobUuid],
  );
  const instancesQuery = useContractInstances(listParams, {
    enabled: canRead && Boolean(jobUuid),
  });
  const templatesQuery = useContractTemplates({
    is_active: "true",
    limit: 100,
    offset: 0,
  });

  const clearPhotos = () => {
    setPhotos((prev) => {
      for (const photo of prev) {
        URL.revokeObjectURL(photo.previewUrl);
      }
      return [];
    });
  };

  const resetSheet = () => {
    setTemplateUuid("");
    setCreated(null);
    setUploadProgress(null);
    clearPhotos();
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const next: PhotoDraft[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_PHOTO_BYTES) {
        toast.error(t("contracts.job.photos_too_large", { name: file.name }));
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (next.length > 0) setPhotos((prev) => [...prev, ...next]);
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const createWithPhotos = async () => {
    const instance = await mutations.createInstance.mutateAsync({
      template_uuid: templateUuid,
      subject_type: "service_job",
      subject_uuid: jobUuid,
      defer_execute: photos.length > 0,
    });
    if (photos.length === 0) {
      setCreated(instance);
      return;
    }
    const failed: string[] = [];
    for (const [index, photo] of photos.entries()) {
      setUploadProgress({ done: index, total: photos.length });
      try {
        await contractsService.uploadMedia(instance.uuid, photo.file);
      } catch {
        failed.push(photo.file.name);
      }
    }
    setUploadProgress(null);
    if (failed.length > 0) {
      toast.error(
        t("contracts.job.photos_failed", { names: failed.join(", ") }),
      );
    }
    // Renders the PDF now when nothing waits for a signature; otherwise the
    // last signature finalizes it (photos are already attached either way).
    const finalized = await contractsService
      .finalizeInstance(instance.uuid)
      .catch(() => instance);
    clearPhotos();
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    setCreated(finalized);
  };

  const creating =
    mutations.createInstance.isPending || uploadProgress !== null;

  if (!canRead) return null;

  const items = instancesQuery.data?.items ?? [];
  const pendingSigner = created ? nextPendingSigner(created) : null;

  return (
    <EntitySectionCard
      title={t("contracts.job.section")}
      badge={items.length}
      action={
        canWrite ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              resetSheet();
              setSheetOpen(true);
            }}
          >
            <FilePlus2 className="size-4" />
            {t("contracts.job.create")}
          </Button>
        ) : undefined
      }
    >
      {instancesQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-muted-foreground text-sm">
            {t("contracts.job.empty")}
          </p>
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                resetSheet();
                setSheetOpen(true);
              }}
            >
              <FilePlus2 className="size-4" />
              {t("contracts.job.create")}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {items.map((item) => {
            const signers = item.signers ?? [];
            const signedCount = signers.filter(
              (s) => s.status === "signed",
            ).length;
            const hasPdf = item.status === "executed" && item.pdf_url;

            return (
              <li
                key={item.uuid}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={routes.tenant.contracts.instanceDetail(
                      slug,
                      item.uuid,
                    )}
                    className="text-primary font-medium hover:underline"
                  >
                    {item.number_label ? `${item.number_label} · ` : ""}
                    {item.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-muted-foreground text-xs">
                      {datetime(item.created_at, "dd.MM.yyyy HH:mm", locale)}
                    </p>
                    {signers.length > 0 ? (
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Users className="size-3" />
                        {signedCount}/{signers.length}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusChip
                    label={
                      t(`contracts.instances.status.${item.status}`) !==
                      `contracts.instances.status.${item.status}`
                        ? t(`contracts.instances.status.${item.status}`)
                        : item.status
                    }
                    tone={statusTone(item.status)}
                  />
                  {hasPdf ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={downloadingUuid === item.uuid}
                      onClick={async () => {
                        setDownloadingUuid(item.uuid);
                        try {
                          await contractsService.downloadPdf(item.uuid);
                        } finally {
                          setDownloadingUuid(null);
                        }
                      }}
                      title={t("contracts.instances.download_pdf")}
                    >
                      <Download className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(next) => {
          if (!next) resetSheet();
          setSheetOpen(next);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>
              {created
                ? t("contracts.job.sheet_sign_title")
                : t("contracts.job.sheet_create_title")}
            </SheetTitle>
            <SheetDescription>
              {created
                ? t("contracts.job.sheet_sign_description")
                : t("contracts.job.sheet_create_description")}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {!created ? (
              <>
                <div className="space-y-2">
                  <Label>{t("contracts.instances.create_template")}</Label>
                  <Select value={templateUuid} onValueChange={setTemplateUuid}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t("contracts.instances.create_template")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(templatesQuery.data?.items ?? []).map((tpl) => (
                        <SelectItem key={tpl.uuid} value={tpl.uuid}>
                          {tpl.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>{t("contracts.job.photos")}</Label>
                    <p className="text-muted-foreground text-xs">
                      {t("contracts.job.photos_hint")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={creating}
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="size-4" />
                      {t("contracts.job.photos_take")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={creating}
                      onClick={() => galleryInputRef.current?.click()}
                    >
                      <ImagePlus className="size-4" />
                      {t("contracts.job.photos_pick")}
                    </Button>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(event) => {
                        addPhotos(event.target.files);
                        event.target.value = "";
                      }}
                    />
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        addPhotos(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                  {photos.length > 0 ? (
                    <ul className="grid grid-cols-3 gap-2">
                      {photos.map((photo) => (
                        <li
                          key={photo.id}
                          className="bg-muted relative aspect-square overflow-hidden rounded-md border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.previewUrl}
                            alt={photo.file.name}
                            className="size-full object-cover"
                          />
                          <button
                            type="button"
                            disabled={creating}
                            onClick={() => removePhoto(photo.id)}
                            className="bg-background/90 hover:bg-background absolute top-1 right-1 rounded-full p-1 shadow-sm"
                            aria-label={t("contracts.job.photos_remove")}
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {uploadProgress ? (
                    <p className="text-muted-foreground text-xs">
                      {t("contracts.job.photos_uploading", {
                        done: String(uploadProgress.done + 1),
                        total: String(uploadProgress.total),
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={creating}
                    onClick={() => setSheetOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="button"
                    disabled={!templateUuid || creating}
                    onClick={() => void createWithPhotos()}
                  >
                    {creating
                      ? t("common.saving")
                      : t("contracts.job.sheet_continue")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{created.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {created.number_label}
                  </p>
                </div>

                {pendingSigner ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium">{pendingSigner.label}</p>
                    <SignerSignForm
                      key={pendingSigner.uuid}
                      instance={created}
                      signer={pendingSigner}
                      cancelLabel={t("contracts.job.sheet_later")}
                      onCancel={() => {
                        setSheetOpen(false);
                        resetSheet();
                      }}
                      onSigned={(updated) => {
                        if (nextPendingSigner(updated)) {
                          setCreated(updated);
                        } else {
                          setSheetOpen(false);
                          resetSheet();
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-muted-foreground text-sm">
                      {t("contracts.job.sheet_done")}
                    </p>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => {
                          setSheetOpen(false);
                          resetSheet();
                        }}
                      >
                        {t("common.close")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </EntitySectionCard>
  );
}
