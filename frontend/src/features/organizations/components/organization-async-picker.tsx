"use client";

import { useCallback, useState } from "react";

import { AppCombobox, type ComboboxOption } from "@/components/forms";
import { organizationsService } from "@/features/organizations/services/organizations.service";
import { useLocale } from "@/providers/locale-provider";

type OrganizationAsyncPickerProps = {
  name: string;
  label?: string;
  description?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Async organization search for forms — `value` is organization UUID.
 * Uses `GET /v1/platform/organizations?q=&limit=20`.
 */
export function OrganizationAsyncPicker({
  name,
  label,
  description,
  className,
  disabled,
}: OrganizationAsyncPickerProps) {
  const { t } = useLocale();
  const [optionCache, setOptionCache] = useState<ComboboxOption[]>([]);

  const loadOptions = useCallback(async (query: string) => {
    const result = await organizationsService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
    });
    const options = result.items.map((organization): ComboboxOption => ({
      value: organization.uuid,
      label: `${organization.name} · /${organization.slug}`,
    }));
    setOptionCache((prev) => {
      const byValue = new Map(prev.map((opt) => [opt.value, opt]));
      for (const opt of options) byValue.set(opt.value, opt);
      return [...byValue.values()];
    });
    return options;
  }, []);

  return (
    <AppCombobox
      name={name}
      label={label}
      description={description}
      className={className}
      disabled={disabled}
      loadOptions={loadOptions}
      options={optionCache}
      placeholder={t("organizations.picker.placeholder")}
      searchPlaceholder={t("organizations.picker.search")}
      emptyText={t("organizations.picker.empty")}
    />
  );
}
