"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  contractKeys,
  useContractMutations,
} from "@/features/contracts/hooks/use-contracts";
import { contractsService } from "@/features/contracts/services/contracts.service";
import { useLocale } from "@/providers/locale-provider";

function ClonePresetDialogBody({
  onOpenChange,
  onCloned,
}: {
  onOpenChange: (open: boolean) => void;
  onCloned: (uuid: string) => void;
}) {
  const { t } = useLocale();
  const mutations = useContractMutations();
  const presetsQuery = useQuery({
    queryKey: [...contractKeys.all, "tenant-presets", { limit: 100 }],
    queryFn: () => contractsService.listPresets({ limit: 100, offset: 0 }),
    retry: false,
  });
  const [presetUuid, setPresetUuid] = useState("");
  const [title, setTitle] = useState("");

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t("contracts.templates.clone_title")}</DialogTitle>
        <DialogDescription>
          {t("contracts.templates.clone_description")}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {(presetsQuery.data?.items ?? []).map((preset) => (
          <button
            key={preset.uuid}
            type="button"
            className={`hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm ${
              presetUuid === preset.uuid ? "bg-muted font-medium" : ""
            }`}
            onClick={() => {
              setPresetUuid(preset.uuid);
              if (!title) setTitle(preset.title);
            }}
          >
            {preset.title}
          </button>
        ))}
        {presetsQuery.isLoading ? (
          <p className="text-muted-foreground px-2 py-1 text-xs">
            {t("common.loading")}
          </p>
        ) : null}
        {!presetsQuery.isLoading &&
        (presetsQuery.data?.items?.length ?? 0) === 0 ? (
          <p className="text-muted-foreground px-2 py-1 text-xs">
            {t("contracts.templates.clone_empty")}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="clone-title">{t("contracts.fields.title")}</Label>
        <Input
          id="clone-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={!presetUuid.trim() || mutations.cloneTemplate.isPending}
          onClick={async () => {
            const created = await mutations.cloneTemplate.mutateAsync({
              preset_uuid: presetUuid.trim(),
              title: title.trim() || undefined,
            });
            onOpenChange(false);
            onCloned(created.uuid);
          }}
        >
          {mutations.cloneTemplate.isPending
            ? t("common.saving")
            : t("contracts.templates.clone_submit")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function ClonePresetDialog({
  open,
  onOpenChange,
  onCloned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (uuid: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ClonePresetDialogBody
          onOpenChange={onOpenChange}
          onCloned={onCloned}
        />
      ) : null}
    </Dialog>
  );
}
