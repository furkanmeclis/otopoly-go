"use client";

import { useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";

import { FilePickButton } from "@/components/common/file-pick-button";
import { AppForm, AppInput, AppSelect } from "@/components/forms";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  createApnsKeyFormSchema,
  type ApnsKeyFormValues,
} from "@/features/integrations/apns/schemas/apns-key-form";
import type { ApnsStatus } from "@/features/integrations/apns/services/apns.service";
import { useLocale } from "@/providers/locale-provider";

// Apple names downloaded keys AuthKey_<KEYID>.p8.
const KEY_FILE_NAME = /AuthKey_([A-Za-z0-9]{10})\.p8$/i;
const MAX_KEY_FILE_BYTES = 16 * 1024;
const FORM_ID = "apns-key-form";

type ApnsKeyDialogProps = {
  open: boolean;
  status: ApnsStatus;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ApnsKeyFormValues) => Promise<void>;
};

export function ApnsKeyDialog({
  open,
  status,
  isSaving,
  onOpenChange,
  onSubmit,
}: ApnsKeyDialogProps) {
  const { t } = useLocale();
  const schema = useMemo(() => createApnsKeyFormSchema(t), [t]);
  const defaultValues = useMemo<ApnsKeyFormValues>(
    () => ({
      key_id: status.key_id,
      team_id: status.team_id,
      bundle_id: status.bundle_id || "com.otopoly.app",
      environment: status.environment,
      private_key: "",
    }),
    [status],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSaving) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {status.stored
              ? t("integrations.apns.dialog.edit_title")
              : t("integrations.apns.dialog.upload_title")}
          </DialogTitle>
          <DialogDescription>
            {t("integrations.apns.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AppForm
            id={FORM_ID}
            schema={schema}
            defaultValues={defaultValues}
            onSubmit={onSubmit}
            className="space-y-4"
          >
            <ApnsKeyFields status={status} disabled={isSaving} />
          </AppForm>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={isSaving}>
            {t("integrations.apns.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApnsKeyFields({
  status,
  disabled,
}: {
  status: ApnsStatus;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const { setValue, getValues, watch, formState } =
    useFormContext<ApnsKeyFormValues>();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const pendingKey = Boolean(watch("private_key"));
  const serverKeyError = formState.errors.private_key?.message;

  const onFile = async (file: File) => {
    setFileError(null);
    if (file.size > MAX_KEY_FILE_BYTES) {
      setFileError(t("integrations.apns.form.private_key_invalid"));
      return;
    }
    const text = await file.text();
    if (!text.includes("-----BEGIN PRIVATE KEY-----")) {
      setFileError(t("integrations.apns.form.private_key_invalid"));
      return;
    }
    setFileName(file.name);
    setValue("private_key", text, { shouldDirty: true });
    const match = KEY_FILE_NAME.exec(file.name);
    if (match && !getValues("key_id")?.trim()) {
      setValue("key_id", match[1].toUpperCase(), { shouldDirty: true });
    }
  };

  let keyHint = t("integrations.apns.form.private_key_hint");
  if (fileName && pendingKey) {
    keyHint = t("integrations.apns.form.private_key_selected", {
      name: fileName,
    });
  } else if (status.stored) {
    keyHint = t("integrations.apns.form.private_key_keep_hint");
  }

  return (
    <>
      <Alert>
        <AlertDescription>{t("integrations.apns.guidance")}</AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="apns-key-file">
          {t("integrations.apns.form.private_key")}
        </Label>
        <FilePickButton
          id="apns-key-file"
          accept=".p8"
          label={t("integrations.apns.form.private_key_choose")}
          disabled={disabled}
          onFile={(file) => void onFile(file)}
        />
        <p className="text-muted-foreground text-sm">{keyHint}</p>
        {fileError || serverKeyError ? (
          <p className="text-destructive text-sm">
            {fileError ?? serverKeyError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AppInput
          name="key_id"
          label={t("integrations.apns.form.key_id")}
          description={t("integrations.apns.form.key_id_hint")}
          maxLength={10}
          autoComplete="off"
          disabled={disabled}
        />
        <AppInput
          name="team_id"
          label={t("integrations.apns.form.team_id")}
          description={t("integrations.apns.form.team_id_hint")}
          maxLength={10}
          autoComplete="off"
          disabled={disabled}
        />
        <AppInput
          name="bundle_id"
          label={t("integrations.apns.form.bundle_id")}
          description={t("integrations.apns.form.bundle_id_hint")}
          autoComplete="off"
          disabled={disabled}
        />
        <AppSelect
          name="environment"
          label={t("integrations.apns.form.environment")}
          description={t("integrations.apns.form.environment_hint")}
          disabled={disabled}
          options={[
            {
              value: "production",
              label: t("integrations.apns.environment.production"),
            },
            {
              value: "sandbox",
              label: t("integrations.apns.environment.sandbox"),
            },
          ]}
        />
      </div>
    </>
  );
}
