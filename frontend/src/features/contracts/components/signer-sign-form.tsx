"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, ShieldCheck } from "lucide-react";

import SignaturePad from "@/components/shadix-ui/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useContractMutations } from "@/features/contracts/hooks/use-contracts";
import type {
  ContractInstance,
  ContractOtpChallenge,
  ContractSigner,
} from "@/features/contracts/services/contracts.service";
import { ApiError } from "@/lib/api/errors";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type PadRef = {
  clear: () => void;
  toDataURL: () => string | null;
  isEmpty: () => boolean;
};

function useSecondsUntil(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [iso]);
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

/**
 * Signing flow for one signer slot. Customer signers on OTP-required contracts
 * first verify a WhatsApp code (contract heading + KVKK notice); the name is
 * pre-filled from the job (customer / assignee / creator).
 *
 * Mount with `key={signer.uuid}` so state resets between signers.
 */
export function SignerSignForm({
  instance,
  signer,
  onSigned,
  onCancel,
  cancelLabel,
}: {
  instance: ContractInstance;
  signer: ContractSigner;
  onSigned: (updated: ContractInstance) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const { t, locale } = useLocale();
  const mutations = useContractMutations();
  const padRef = useRef<PadRef>(null);
  const [displayName, setDisplayName] = useState(signer.suggested_name ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [phone, setPhone] = useState(signer.phone ?? "");
  const [challenge, setChallenge] = useState<ContractOtpChallenge | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(signer.otp_verified);
  const resendIn = useSecondsUntil(challenge?.resend_at ?? null);

  const needsOtp = signer.otp_required && !verified;
  const plate = instance.variables_resolved?.plate;

  // Errors surface via the mutation toasts; swallow the rejection here.
  const sendCode = async () => {
    try {
      const result = await mutations.sendSignerOtp.mutateAsync({
        instanceUuid: instance.uuid,
        signerUuid: signer.uuid,
        phone,
      });
      setChallenge(result);
      setCode("");
    } catch {}
  };

  if (needsOtp) {
    return (
      <div className="space-y-4">
        <div className="bg-muted/40 space-y-1 rounded-lg border p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <MessageCircle className="size-4 text-emerald-600" />
            {t("contracts.otp.title")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("contracts.otp.description")}
          </p>
          <ul className="text-muted-foreground mt-2 space-y-0.5 text-xs">
            <li>
              {t("contracts.otp.summary_contract")}:{" "}
              <span className="text-foreground">
                {instance.title} · {instance.number_label}
              </span>
            </li>
            {plate ? (
              <li>
                {t("contracts.otp.summary_plate")}:{" "}
                <span className="text-foreground">{plate}</span>
              </li>
            ) : null}
            <li>{t("contracts.otp.summary_kvkk")}</li>
          </ul>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`otp-phone-${signer.uuid}`}>
            {t("contracts.otp.phone")}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`otp-phone-${signer.uuid}`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05XX XXX XX XX"
            />
            <Button
              type="button"
              variant={challenge ? "outline" : "default"}
              className="shrink-0"
              disabled={
                !phone.trim() ||
                mutations.sendSignerOtp.isPending ||
                resendIn > 0
              }
              onClick={sendCode}
            >
              {mutations.sendSignerOtp.isPending
                ? t("contracts.otp.sending")
                : challenge
                  ? resendIn > 0
                    ? t("contracts.otp.resend_in", { seconds: resendIn })
                    : t("contracts.otp.resend")
                  : t("contracts.otp.send")}
            </Button>
          </div>
        </div>

        {challenge ? (
          <div className="space-y-2">
            <Label htmlFor={`otp-code-${signer.uuid}`}>
              {t("contracts.otp.code")}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t("contracts.otp.code_hint", {
                phone: challenge.phone_masked,
                time: datetime(challenge.expires_at, "HH:mm", locale),
              })}
            </p>
            <div className="flex gap-2">
              <Input
                id={`otp-code-${signer.uuid}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="font-mono tracking-[0.4em]"
                placeholder="••••••"
              />
              <Button
                type="button"
                className="shrink-0"
                disabled={
                  code.length !== 6 || mutations.verifySignerOtp.isPending
                }
                onClick={async () => {
                  try {
                    await mutations.verifySignerOtp.mutateAsync({
                      instanceUuid: instance.uuid,
                      signerUuid: signer.uuid,
                      code,
                    });
                    setVerified(true);
                  } catch {
                    setCode("");
                  }
                }}
              >
                {mutations.verifySignerOtp.isPending
                  ? t("common.saving")
                  : t("contracts.otp.verify")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {signer.otp_required ? (
        <p className="flex items-center gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="size-4 shrink-0" />
          {t("contracts.otp.verified")}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={`sign-name-${signer.uuid}`}>
          {t("contracts.instances.sign_display_name")}
        </Label>
        <Input
          id={`sign-name-${signer.uuid}`}
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
        <p className="font-medium">{t("contracts.instances.disclaimer")}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {t("contracts.instances.disclaimer_body")}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={
            !displayName.trim() || !signature || mutations.sign.isPending
          }
          onClick={async () => {
            if (!signature) return;
            try {
              const updated = await mutations.sign.mutateAsync({
                instanceUuid: instance.uuid,
                signerUuid: signer.uuid,
                body: {
                  display_name: displayName.trim(),
                  signature_png_base64: signature,
                },
              });
              onSigned(updated);
            } catch (err) {
              // Verification window (30 min) elapsed: go back to the OTP step.
              if (err instanceof ApiError && err.code === "OTP_REQUIRED") {
                setVerified(false);
                setChallenge(null);
              }
            }
          }}
        >
          {mutations.sign.isPending
            ? t("common.saving")
            : t("contracts.instances.sign_submit")}
        </Button>
      </div>
    </div>
  );
}
