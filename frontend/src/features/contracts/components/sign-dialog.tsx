"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignerSignForm } from "@/features/contracts/components/signer-sign-form";
import type { ContractInstance } from "@/features/contracts/services/contracts.service";
import { useLocale } from "@/providers/locale-provider";

export function SignDialog({
  open,
  onOpenChange,
  instance,
  signerUuid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: ContractInstance;
  signerUuid: string | null;
}) {
  const { t } = useLocale();
  // Resolve from the live instance so OTP verification state stays current.
  const signer =
    instance.signers?.find((s) => s.uuid === signerUuid) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("contracts.instances.sign_title")}</DialogTitle>
          <DialogDescription>
            {signer
              ? `${signer.label} · ${t("contracts.instances.sign_description")}`
              : t("contracts.instances.sign_description")}
          </DialogDescription>
        </DialogHeader>

        {signer ? (
          <SignerSignForm
            key={signer.uuid}
            instance={instance}
            signer={signer}
            onSigned={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
