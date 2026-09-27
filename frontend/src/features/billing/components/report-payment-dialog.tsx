"use client";

import { useState } from "react";

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
import { useBillingOrderMutations } from "@/features/billing/hooks/use-billing";
import { useLocale } from "@/providers/locale-provider";

const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export function ReportPaymentDialog({
  orderUuid,
  open,
  onOpenChange,
}: {
  orderUuid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { report } = useBillingOrderMutations();

  const pick = (f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (!ACCEPT.includes(f.type))
      return setError(t("billing.report.file_type"));
    if (f.size > MAX_BYTES) return setError(t("billing.report.file_size"));
    setFile(f);
  };

  const submit = async () => {
    if (!file) return setError(t("billing.report.file_required"));
    try {
      await report.mutateAsync({ uuid: orderUuid, file, note: note.trim() });
      setFile(null);
      setNote("");
      onOpenChange(false);
    } catch {
      /* toast via global handler */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.report.title")}</DialogTitle>
          <DialogDescription>
            {t("billing.report.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="receipt" className="mb-1 block">
              {t("billing.report.file")}
            </Label>
            <Input
              id="receipt"
              type="file"
              accept={ACCEPT.join(",")}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {t("billing.report.file_hint")}
            </p>
          </div>
          <div>
            <Label htmlFor="receipt-note" className="mb-1 block">
              {t("billing.report.note")}
            </Label>
            <Textarea
              id="receipt-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("billing.admin.plan.cancel")}
          </Button>
          <Button onClick={submit} disabled={report.isPending}>
            {t("billing.report.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
