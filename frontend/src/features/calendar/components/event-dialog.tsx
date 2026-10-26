"use client";

import { format, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  AppDatePicker,
  AppForm,
  AppInput,
  AppSwitch,
  AppTextarea,
} from "@/components/forms";
import { FormFieldShell } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import {
  CALENDAR_COLORS,
  COLOR_CLASSES,
  COLOR_LABEL_KEYS,
} from "@/features/calendar/components/views/types";
import { useCalendarMutations } from "@/features/calendar/hooks/use-calendar";
import type {
  CalendarEvent,
  CalendarEventInput,
} from "@/features/calendar/types";
import { cn } from "@/lib/utils";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export type EventDraft = { start: Date; allDay: boolean };

type EventDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode when set. */
  event?: CalendarEvent | null;
  /** Prefill for a new event (clicked slot). */
  draft?: EventDraft | null;
};

const day = (d: Date) => format(d, "yyyy-MM-dd");
const time = (d: Date) => format(d, "HH:mm");

function defaults(event?: CalendarEvent | null, draft?: EventDraft | null) {
  if (event) {
    const start = parseISO(event.starts_at);
    const end = parseISO(event.ends_at);
    return {
      title: event.title,
      all_day: event.all_day,
      start_date: event.start_date ?? day(start),
      end_date: event.end_date ?? day(end),
      start_time: time(start),
      end_time: time(end),
      location: event.location,
      description: event.description,
      color: event.color as string,
    };
  }
  const start = draft?.start ?? new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    all_day: draft?.allDay ?? false,
    start_date: day(start),
    end_date: day(draft?.allDay ? start : end),
    start_time: draft?.allDay ? "09:00" : time(start),
    end_time: draft?.allDay ? "10:00" : time(end),
    location: "",
    description: "",
    color: "blue",
  };
}

export function EventDialog({
  open,
  onOpenChange,
  event,
  draft,
}: EventDialogProps) {
  const { t } = useLocale();
  const { confirm } = useDialogs();
  const { create, update, remove } = useCalendarMutations();
  const pending = create.isPending || update.isPending;

  const schema = useMemo(
    () =>
      z
        .object({
          title: z.string().trim().min(1, t("calendar.event.validation.title")),
          all_day: z.boolean(),
          start_date: z.string().min(1),
          end_date: z.string().min(1),
          start_time: z.string(),
          end_time: z.string(),
          location: z.string().optional(),
          description: z.string().optional(),
          color: z.enum(CALENDAR_COLORS),
        })
        .superRefine((v, ctx) => {
          const start = v.all_day
            ? v.start_date
            : `${v.start_date}T${v.start_time}`;
          const end = v.all_day ? v.end_date : `${v.end_date}T${v.end_time}`;
          if (v.all_day ? end < start : end <= start) {
            ctx.addIssue({
              code: "custom",
              path: ["end_date"],
              message: t("calendar.event.validation.range"),
            });
          }
        }),
    [t],
  );

  async function onSubmit(values: z.infer<typeof schema>) {
    const body: CalendarEventInput = {
      title: values.title.trim(),
      all_day: values.all_day,
      color: values.color,
      location: values.location?.trim() ?? "",
      description: values.description?.trim() ?? "",
    };
    if (values.all_day) {
      body.start_date = values.start_date;
      body.end_date = values.end_date;
    } else {
      body.starts_at = new Date(
        `${values.start_date}T${values.start_time}:00`,
      ).toISOString();
      body.ends_at = new Date(
        `${values.end_date}T${values.end_time}:00`,
      ).toISOString();
    }
    if (event) {
      await update.mutateAsync({ uuid: event.uuid, body });
    } else {
      await create.mutateAsync(body);
    }
    toast.success(t("calendar.event.saved"));
    onOpenChange(false);
  }

  async function onDelete() {
    if (!event) return;
    const ok = await confirm({
      title: t("calendar.event.delete"),
      description: t("calendar.event.delete_confirm", { title: event.title }),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    });
    if (!ok) return;
    await remove.mutateAsync(event.uuid);
    toast.success(t("calendar.event.deleted"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {event
              ? t("calendar.event.edit_title")
              : t("calendar.event.create_title")}
          </DialogTitle>
          <DialogDescription>{t("calendar.subtitle")}</DialogDescription>
        </DialogHeader>
        <AppForm
          key={
            open
              ? `event-${event?.uuid ?? draft?.start.getTime() ?? "new"}`
              : "closed"
          }
          schema={schema}
          defaultValues={defaults(event, draft) as z.infer<typeof schema>}
          onSubmit={onSubmit}
        >
          {(form) => {
            const allDay = form.watch("all_day");
            return (
              <FieldGroup>
                <AppInput
                  name="title"
                  label={t("calendar.event.title")}
                  placeholder={t("calendar.event.title_placeholder")}
                  autoFocus
                />
                <AppSwitch name="all_day" label={t("calendar.event.all_day")} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <AppDatePicker
                    name="start_date"
                    label={t("calendar.event.start_date")}
                  />
                  {allDay ? null : (
                    <AppInput
                      name="start_time"
                      type="time"
                      label={t("calendar.event.start_time")}
                    />
                  )}
                  <AppDatePicker
                    name="end_date"
                    label={t("calendar.event.end_date")}
                  />
                  {allDay ? null : (
                    <AppInput
                      name="end_time"
                      type="time"
                      label={t("calendar.event.end_time")}
                    />
                  )}
                </div>
                <FormFieldShell name="color" label={t("calendar.event.color")}>
                  <Controller
                    name="color"
                    control={form.control}
                    render={({ field }) => (
                      <div
                        role="radiogroup"
                        aria-label={t("calendar.event.color")}
                        className="flex flex-wrap gap-2"
                      >
                        {CALENDAR_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            role="radio"
                            aria-checked={field.value === color}
                            aria-label={t(COLOR_LABEL_KEYS[color])}
                            title={t(COLOR_LABEL_KEYS[color])}
                            onClick={() => field.onChange(color)}
                            className={cn(
                              "ring-offset-background size-7 rounded-full ring-offset-2 transition",
                              COLOR_CLASSES[color].dot,
                              field.value === color
                                ? "ring-foreground ring-2"
                                : "opacity-80 hover:opacity-100",
                            )}
                          />
                        ))}
                      </div>
                    )}
                  />
                </FormFieldShell>
                <AppInput
                  name="location"
                  label={t("calendar.event.location")}
                />
                <AppTextarea
                  name="description"
                  label={t("calendar.event.description")}
                  rows={3}
                />
                <DialogFooter className="gap-2 pt-2 sm:justify-between">
                  {event ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive"
                      disabled={remove.isPending}
                      onClick={() => void onDelete()}
                    >
                      <Trash2 aria-hidden />
                      {t("calendar.event.delete")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" disabled={pending}>
                      {pending ? t("common.loading") : t("common.save")}
                    </Button>
                  </div>
                </DialogFooter>
              </FieldGroup>
            );
          }}
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
