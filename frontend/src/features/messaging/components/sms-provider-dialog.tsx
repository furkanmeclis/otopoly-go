"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { AppForm, AppInput, AppSwitch } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSaveSmsProvider } from "@/features/messaging/hooks/use-sms-channel";
import type { SmsProviderEntry } from "@/features/messaging/types";
import { useLocale } from "@/providers/locale-provider";

type SmsProviderDialogProps = {
  entry: SmsProviderEntry | null;
  /** Another provider is the active SMS channel right now. */
  otherActive: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormValues = Record<string, string | boolean>;

export function SmsProviderDialog({
  entry,
  otherActive,
  onOpenChange,
}: SmsProviderDialogProps) {
  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      {entry ? (
        <SmsProviderDialogBody
          key={entry.provider}
          entry={entry}
          otherActive={otherActive}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function SmsProviderDialogBody({
  entry,
  otherActive,
  onDone,
}: {
  entry: SmsProviderEntry;
  otherActive: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const save = useSaveSmsProvider();
  const account = entry.account;
  const editing = Boolean(account);
  const p = entry.provider;

  const schema = useMemo(() => {
    const shape: Record<string, z.ZodType<string | boolean>> = {
      sender: z
        .string()
        .trim()
        .min(1, t("messaging.sms.form.required"))
        .max(64, t("messaging.sms.form.too_long")),
      activate: z.boolean(),
    };
    for (const f of entry.fields) {
      // Editing: empty keeps the stored value.
      shape[f.key] =
        f.required && !editing
          ? z.string().trim().min(1, t("messaging.sms.form.required"))
          : z.string().trim();
    }
    return z.object(shape) as unknown as z.ZodType<FormValues>;
  }, [entry.fields, editing, t]);

  const defaultValues = useMemo<FormValues>(() => {
    const values: FormValues = {
      sender: account?.sender ?? "",
      activate: account ? account.is_active : !otherActive,
    };
    for (const f of entry.fields) values[f.key] = "";
    return values;
  }, [account, entry.fields, otherActive]);

  async function onSubmit(values: FormValues) {
    const credentials: Record<string, string> = {};
    for (const f of entry.fields) {
      const v = String(values[f.key] ?? "").trim();
      if (v) credentials[f.key] = v;
    }
    try {
      await save.mutateAsync({
        provider: p,
        body: {
          credentials,
          sender: String(values.sender ?? "").trim(),
          activate: Boolean(values.activate),
        },
      });
      onDone();
    } catch {
      // toast shown by the mutation
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {t(
            editing
              ? "messaging.sms.form.edit_title"
              : "messaging.sms.form.connect_title",
            { provider: t(`messaging.sms.providers.${p}.name`) },
          )}
        </DialogTitle>
        <DialogDescription>
          {t(`messaging.sms.providers.${p}.form_hint`)}
        </DialogDescription>
      </DialogHeader>
      <AppForm
        schema={schema}
        defaultValues={defaultValues}
        onSubmit={onSubmit}
      >
        <div className="space-y-4">
          {entry.fields.map((f) => {
            const hint = account?.credential_hints?.[f.key];
            return (
              <AppInput
                key={f.key}
                name={f.key}
                type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "new-password" : "off"}
                label={t(`messaging.sms.fields.${f.key}`)}
                labelAction={
                  hint ? (
                    <Badge
                      variant="secondary"
                      className="font-mono text-[10px]"
                    >
                      {hint}
                    </Badge>
                  ) : undefined
                }
                description={t(`messaging.sms.fields.${f.key}_hint`)}
                placeholder={
                  editing ? t("messaging.sms.form.keep_placeholder") : undefined
                }
              />
            );
          })}
          <AppInput
            name="sender"
            autoComplete="off"
            label={t(`messaging.sms.sender.${entry.sender_kind}`)}
            description={t(`messaging.sms.sender.${entry.sender_kind}_hint`)}
            placeholder={
              entry.sender_kind === "from" ? "+15005550006" : "FIRMA"
            }
          />
          <AppSwitch
            name="activate"
            label={t("messaging.sms.form.activate")}
            description={
              otherActive
                ? t("messaging.sms.form.activate_switch_hint")
                : t("messaging.sms.form.activate_hint")
            }
          />
        </div>
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {editing
              ? t("messaging.sms.form.save")
              : t("messaging.sms.form.connect")}
          </Button>
        </DialogFooter>
      </AppForm>
    </DialogContent>
  );
}
