"use client";

import { Controller, useFormContext } from "react-hook-form";

import { FormFieldShell } from "@/components/forms/form-field";
import { TimePicker } from "@/components/ui/time-picker";

type AppTimePickerProps = {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

/** Form-bound time field. Value stored as `HH:mm`. */
export function AppTimePicker({
  name,
  label,
  description,
  placeholder,
  className,
  disabled,
}: AppTimePickerProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext();
  const error = errors[name]?.message as string | undefined;

  return (
    <FormFieldShell
      name={name}
      label={label}
      description={description}
      error={error}
      className={className}
    >
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <TimePicker
            id={name}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={field.onChange}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            className={error ? "border-destructive" : undefined}
          />
        )}
      />
    </FormFieldShell>
  );
}
