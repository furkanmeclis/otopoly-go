"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

function statusTone(status: string) {
  switch (status) {
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
    <EntitySectionCard title={t("contracts.job.section")} badge={items.length}>
      {canWrite ? (
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCreateOpen(true)}
          >
            {t("contracts.job.create")}
          </Button>
        </div>
      ) : null}

      {instancesQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("contracts.job.empty")}
        </p>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {items.map((item) => (
            <li
              key={item.uuid}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={routes.tenant.contracts.instanceDetail(slug, item.uuid)}
                  className="text-primary font-medium hover:underline"
                >
                  {item.number_label ? `${item.number_label} · ` : ""}
                  {item.title}
                </Link>
                <p className="text-muted-foreground text-xs">
                  {datetime(item.created_at, "dd.MM.yyyy HH:mm", locale)}
                </p>
              </div>
              <StatusChip
                label={
                  t(`contracts.instances.status.${item.status}`) !==
                  `contracts.instances.status.${item.status}`
                    ? t(`contracts.instances.status.${item.status}`)
                    : item.status
                }
                tone={statusTone(item.status)}
              />
            </li>
          ))}
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