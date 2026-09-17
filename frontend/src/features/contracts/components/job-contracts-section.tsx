"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FilePlus2, Users } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { EntitySectionCard } from "@/components/entity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routes } from "@/config/routes";
import {
  useContractInstances,
  useContractMutations,
  useContractTemplates,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import { contractsService } from "@/features/contracts/services/contracts.service";
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

export function JobContractsSection({
  slug,
  jobUuid,
}: {
  slug: string;
  jobUuid: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantContractsAccess(slug);
  const [createOpen, setCreateOpen] = useState(false);
  const [templateUuid, setTemplateUuid] = useState("");
  const [downloadingUuid, setDownloadingUuid] = useState<string | null>(null);
  const mutations = useContractMutations();

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

  if (!canRead) return null;

  const items = instancesQuery.data?.items ?? [];

  return (
    <EntitySectionCard
      title={t("contracts.job.section")}
      badge={items.length}
      action={
        canWrite ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
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
              onClick={() => setCreateOpen(true)}
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
            const signedCount = signers.filter((s) => s.status === "signed").length;
            const hasPdf = item.status === "executed" && item.pdf_url;

            return (
              <li
                key={item.uuid}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={routes.tenant.contracts.instanceDetail(slug, item.uuid)}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("contracts.instances.create_title")}</DialogTitle>
            <DialogDescription>
              {t("contracts.instances.create_description")}
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!templateUuid || mutations.createInstance.isPending}
              onClick={async () => {
                const created = await mutations.createInstance.mutateAsync({
                  template_uuid: templateUuid,
                  subject_type: "service_job",
                  subject_uuid: jobUuid,
                });
                setCreateOpen(false);
                setTemplateUuid("");
                router.push(
                  routes.tenant.contracts.instanceDetail(slug, created.uuid),
                );
              }}
            >
              {mutations.createInstance.isPending
                ? t("common.saving")
                : t("contracts.instances.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EntitySectionCard>
  );
}
