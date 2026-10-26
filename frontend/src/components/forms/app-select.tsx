"use client";

import type { ReactNode } from "react";
import { Controller, useFormContext } from "react-hook-form";

import { FormFieldShell } from "@/components/forms/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = {
  label: string;
  value: string;
  /** Leading visual (e.g. vehicle brand logo), also shown in the trigger. */
  icon?: ReactNode;
};

type AppSelectProps = {
  name: string;
  label?: string;
  description?: string;
  placeholder?: string;
  options: Option[];
  className?: string;
  disabled?: boolean;
};

export function AppSelect({
  name,
  label,
  description,
  placeholder,
  options,
  className,
  disabled,
}: AppSelectProps) {
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
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <SelectTrigger
              id={name}
              aria-invalid={Boolean(error)}
              className="w-full"
              disabled={disabled}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.icon ? (
                    <span className="flex min-w-0 items-center gap-2">
                      {option.icon}
                      <span className="truncate">{option.label}</span>
                    </span>
                  ) : (
                    option.label
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FormFieldShell>
  );
}
