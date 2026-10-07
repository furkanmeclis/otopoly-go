"use client";

import { useState } from "react";

import { AppDialog } from "@/components/dialogs/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useExtendOrganizationAccess } from "@/features/organizations/hooks/use-organization-mutations";
import type { Organization } from "@/features/organizations/services/organizations.service";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const PRESETS = [7, 30, 90, 365];
const MAX_DAYS = 3650;

type OrganizationExtendAccessDialogProps = {
  organization: Organization;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** New end = max(now, current end) + days (mirrors the API). */
function previewEnd(currentEnd: string | null | undefined, days: number) {
  const now = new Date();
  const end = currentEnd ? new Date(currentEnd) : now;
  const base = end > now ? end : now;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

export function OrganizationExtendAccessDialog({
  organization,
  open,
  onOpenChange,
}: OrganizationExtendAccessDialogProps) {
  const { t, locale } = useLocale();
  const extend = useExtendOrganizationAccess();
  const [days, setDays] = useState(30);
  const [note, setNote] = useState("");
  const valid = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS;

  const close = (next: boolean) => {
    if (extend.isPending) return;
    if (!next) {
      setDays(30);
      setNote("");
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!valid) return;
    await extend.mutateAsync({
      uuid: organization.uuid,
      body: { days, note: note.trim() || undefined },
    });
    close(false);
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={close}
      title={t("organizations.extend.title")}
      description={t("organizations.extend.description")}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={extend.isPending}
            onClick={() => close(false)}
          >
            {t("form.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!valid || extend.isPending}
            onClick={() => void submit()}
          >
            {t("organizations.actions.extend_access")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="extend-days">{t("organizations.extend.days")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="extend-days"
              type="number"
              min={1}
              max={MAX_DAYS}
              value={Number.isNaN(days) ? "" : days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-28"
            />
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={days === preset ? "secondary" : "outline"}
                onClick={() => setDays(preset)}
              >
                {t("organizations.extend.preset_days", { days: preset })}
              </Button>
            ))}
          </div>
          {valid ? (
            <p className="text-muted-foreground text-xs">
              {t("organizations.extend.preview", {
                from: organization.access_ends_at
                  ? date(organization.access_ends_at, "dd.MM.yyyy", locale)
                  : "—",
                to: date(
                  previewEnd(organization.access_ends_at, days),
                  "dd.MM.yyyy",
                  locale,
                ),
              })}
            </p>
          ) : (
            <p className="text-destructive text-xs">
              {t("organizations.extend.days_invalid", { max: MAX_DAYS })}
            </p>
          )}
          {organization.status === "suspended" ? (
            <p className="text-muted-foreground text-xs">
              {t("organizations.extend.suspended_hint")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="extend-note">{t("organizations.extend.note")}</Label>
          <Textarea
            id="extend-note"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("organizations.extend.note_placeholder")}
          />
        </div>
      </div>
    </AppDialog>
  );
}
