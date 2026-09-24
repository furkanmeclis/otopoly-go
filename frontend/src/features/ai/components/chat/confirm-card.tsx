"use client";

import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Pencil,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { routes } from "@/config/routes";
import { useChatActions } from "@/features/ai/components/chat/chat-actions";
import {
  actionErrorKey,
  confirmFieldKey,
  confirmStatusKey,
  confirmWarningKey,
  isConfirmValueKey,
  isSummaryKey,
  toolLabelKey,
} from "@/features/ai/lib/labels";
import type {
  AIActionLink,
  AIActionStatus,
  AIConfirmCard,
  AIEditField,
  AIUIBlock,
} from "@/features/ai/types";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const NONE = "__none__";

function linkHref(slug: string, link: AIActionLink): string {
  switch (link.kind) {
    case "customer":
      return routes.tenant.customers.detail(slug, link.uuid);
    case "cari":
      return routes.tenant.cari.detail(slug, link.uuid);
    case "job":
      return routes.tenant.operations.detail(slug, link.uuid);
    case "sale":
      return routes.tenant.sales.detail(slug, link.uuid);
    case "finance_account":
      return routes.tenant.finance.accounts.detail(slug, link.uuid);
    default:
      return routes.tenant.todos.root(slug);
  }
}

const STATUS_STYLE: Record<AIActionStatus, string> = {
  pending: "border-primary/40",
  executing: "border-primary/40",
  confirmed: "border-emerald-500/40",
  failed: "border-destructive/40",
  cancelled: "border-border opacity-80",
  expired: "border-border opacity-80",
};

function StatusBadge({ status }: { status: AIActionStatus }) {
  const { t } = useLocale();
  const Icon =
    status === "confirmed"
      ? Check
      : status === "failed"
        ? AlertTriangle
        : status === "executing"
          ? Loader2
          : status === "pending"
            ? Clock
            : Ban;
  return (
    <Badge
      variant={
        status === "confirmed"
          ? "success"
          : status === "failed"
            ? "danger"
            : "secondary"
      }
      className="gap-1 font-normal"
    >
      <Icon
        className={cn("size-3", status === "executing" && "animate-spin")}
      />
      {t(confirmStatusKey(status))}
    </Badge>
  );
}

function EditInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: AIEditField;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const id = `edit-${field.key}`;
  switch (field.type) {
    case "select":
      return (
        <Select
          value={value === "" ? NONE : value}
          onValueChange={(v) => onChange(v === NONE ? "" : v)}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value || NONE} value={o.value || NONE}>
                {o.label_key && isConfirmValueKey(o.label_key)
                  ? t(o.label_key)
                  : (o.label ?? o.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "date":
      return (
        <DatePicker
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="h-8 w-full text-sm"
        />
      );
    case "textarea":
      return (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={2}
          className="text-sm"
        />
      );
    default:
      return (
        <Input
          id={id}
          type={field.type === "time" ? "time" : "text"}
          inputMode={field.type === "money" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-8 text-sm"
        />
      );
  }
}

/**
 * Confirmation card for a write action the assistant proposed. Nothing is
 * changed until the user confirms; key fields can be edited inline first.
 */
export function ConfirmCard({ block }: { block: AIUIBlock }) {
  const { t, locale } = useLocale();
  const actions = useChatActions();
  const card = block.data as AIConfirmCard | undefined;
  const status = (block.status ?? "pending") as AIActionStatus;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  if (!card) return null;
  const { preview, result } = card;
  const editable = preview.edit ?? [];
  const pending = status === "pending";
  const busy = submitting || Boolean(actions?.busy);

  const valueOf = (f: AIEditField) => values[f.key] ?? f.value ?? "";
  const changedEdits = () =>
    Object.fromEntries(
      editable
        .filter((f) => values[f.key] !== undefined && values[f.key] !== f.value)
        .map((f) => [f.key, values[f.key] ?? ""]),
    );

  const run = async (fn: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await fn();
      setEditing(false);
    } catch (error) {
      toast.error(
        t(actionErrorKey(isApiError(error) ? error.code : undefined)),
        {
          description:
            isApiError(error) && error.code === "VALIDATION_ERROR"
              ? error.message
              : undefined,
        },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const title = t(toolLabelKey(preview.action));

  return (
    <div
      className={cn(
        "bg-card overflow-hidden rounded-xl border-2 shadow-sm",
        STATUS_STYLE[status],
      )}
      data-block="confirm"
      data-status={status}
    >
      <div className="flex items-start justify-between gap-3 border-b px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
            <ShieldCheck className="size-3.5" />
            {title}
          </p>
          <p className="truncate text-sm font-semibold">{preview.title}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {preview.amount ? (
            <span className="text-base font-semibold tabular-nums">
              {preview.amount}
            </span>
          ) : null}
          <StatusBadge status={status} />
        </div>
      </div>

      {editing ? (
        <div className="grid gap-2.5 px-3.5 py-3 sm:grid-cols-2">
          {editable.map((f) => (
            <div
              key={f.key}
              className={cn(
                "space-y-1",
                (f.type === "textarea" || f.key === "description") &&
                  "sm:col-span-2",
              )}
            >
              <Label htmlFor={`edit-${f.key}`} className="text-xs">
                {t(confirmFieldKey(f.key))}
                {f.required ? " *" : ""}
              </Label>
              <EditInput
                field={f}
                value={valueOf(f)}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                disabled={busy}
              />
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3.5 py-2.5 text-sm">
          {preview.fields.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-muted-foreground text-xs leading-5">
                {t(confirmFieldKey(f.key))}
              </dt>
              <dd className="min-w-0 break-words">
                {f.value_key && isConfirmValueKey(f.value_key)
                  ? t(f.value_key)
                  : f.value && /^\d{4}-\d{2}-\d{2}$/.test(f.value)
                    ? datetime(`${f.value}T00:00:00`, "d MMMM yyyy", locale)
                    : f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {preview.warnings?.length && pending ? (
        <div className="space-y-1 px-3.5 pb-2.5">
          {preview.warnings.map((w) => (
            <p
              key={w}
              className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {t(confirmWarningKey(w))}
            </p>
          ))}
        </div>
      ) : null}

      {result && !pending ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2 text-xs",
            result.ok
              ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/5 text-destructive",
          )}
        >
          <span>
            {result.ok
              ? isSummaryKey(result.summary_key)
                ? t(
                    result.summary_key,
                    (result.summary_params ?? {}) as Record<
                      string,
                      string | number
                    >,
                  )
                : t("ai.confirm.done")
              : result.message || t("ai.confirm.failed")}
          </span>
          {result.link && actions?.slug ? (
            <Link
              href={linkHref(actions.slug, result.link)}
              className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
            >
              {t("ai.confirm.open_record")}
              <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {pending && actions ? (
        <div className="bg-muted/30 flex flex-wrap items-center justify-end gap-2 border-t px-3.5 py-2">
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setValues({});
              }}
              disabled={busy}
            >
              {t("ai.confirm.back")}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void run(() => actions.cancel(block))}
                disabled={busy}
              >
                <X className="size-3.5" />
                {t("ai.confirm.cancel")}
              </Button>
              {editable.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(true)}
                  disabled={busy}
                >
                  <Pencil className="size-3.5" />
                  {t("ai.confirm.edit")}
                </Button>
              ) : null}
            </>
          )}
          <Button
            size="sm"
            onClick={() =>
              void run(() =>
                actions.confirm(block, editing ? changedEdits() : undefined),
              )
            }
            disabled={busy}
            data-action="confirm"
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {editing ? t("ai.confirm.save_confirm") : t("ai.confirm.confirm")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
