"use client";

import { useRef, useState } from "react";

import SignaturePad from "@/components/shadix-ui/components/signature-pad";
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
import { useContractMutations } from "@/features/contracts/hooks/use-contracts";
import type { ContractSigner } from "@/features/contracts/services/contracts.service";
import { useLocale } from "@/providers/locale-provider";

type PadRef = {
  clear: () => void;
  toDataURL: () => string | null;
  isEmpty: () => boolean;
};

export function SignDialog({
  open,
  onOpenChange,
  instanceUuid,
  signer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceUuid: string;
  signer: ContractSigner | null;
}) {
  const { t } = useLocale();
  const mutations = useContractMutations();
  const padRef = useRef<PadRef>(null);
  const [displayName, setDisplayName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDisplayName("");
          setSignature(null);
          padRef.current?.clear();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("contracts.instances.sign_title")}</DialogTitle>
          <DialogDescription>
            {signer
              ? `${signer.label} · ${t("contracts.instances.sign_description")}`
              : t("contracts.instances.sign_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="display-name">
              {t("contracts.instances.sign_display_name")}
            </Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <SignaturePad
            ref={padRef as never}
            showButtons
            onChange={setSignature}
            className="bg-background"
          />

          <div className="bg-muted/40 rounded-md border p-3 text-sm">
            <p className="font-medium">
              {t("contracts.instances.disclaimer")}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {t("contracts.instances.disclaimer_body")}
            </p>
          </div>
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
            disabled={
              !signer ||
              !displayName.trim() ||
              !signature ||
              mutations.sign.isPending
            }
            onClick={async () => {
              if (!signer || !signature) return;
              await mutations.sign.mutateAsync({
                instanceUuid,
                signerUuid: signer.uuid,
                body: {
                  display_name: displayName.trim(),
                  signature_png_base64: signature,
                },
              });
              onOpenChange(false);
            }}
          >
            {mutations.sign.isPending
              ? t("common.saving")
              : t("contracts.instances.sign_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
