"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { SmsSegmentCounter } from "@/features/messaging/components/sms-segment-counter";
import { useSendTestSms } from "@/features/messaging/hooks/use-sms-channel";
import type { SmsProviderCode } from "@/features/messaging/types";
import { useLocale } from "@/providers/locale-provider";

type SmsTestDialogProps = {
  provider: SmsProviderCode | null;
  onOpenChange: (open: boolean) => void;
};

export function SmsTestDialog({ provider, onOpenChange }: SmsTestDialogProps) {
  return (
    <Dialog open={Boolean(provider)} onOpenChange={onOpenChange}>
      {provider ? (
        <SmsTestDialogBody
          key={provider}
          provider={provider}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function SmsTestDialogBody({
  provider,
  onDone,
}: {
  provider: SmsProviderCode;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const send = useSendTestSms();
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState(() => t("messaging.sms.test.default_body"));

  async function handleSend() {
    try {
      const res = await send.mutateAsync({
        provider,
        body: { phone: phone.trim(), body: body.trim() },
      });
      if (res.status === "sent") onDone();
    } catch {
      // toast shown by the mutation
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {t("messaging.sms.test.title", {
            provider: t(`messaging.sms.providers.${provider}.name`),
          })}
        </DialogTitle>
        <DialogDescription>
          {t("messaging.sms.test.description")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sms-test-phone">
            {t("messaging.sms.test.phone")}
          </Label>
          <Input
            id="sms-test-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0532 123 45 67"
            inputMode="tel"
            autoComplete="tel"
          />
          <p className="text-muted-foreground text-xs">
            {t("messaging.sms.test.phone_hint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sms-test-body">{t("messaging.sms.test.body")}</Label>
          <Textarea
            id="sms-test-body"
            value={body}
            rows={4}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
          />
          <SmsSegmentCounter body={body} provider={provider} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={() => void handleSend()}
          disabled={send.isPending || !phone.trim() || !body.trim()}
        >
          {send.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Send className="mr-2 size-4" />
          )}
          {t("messaging.sms.test.send")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
