"use client";

import { useCallback } from "react";

import { AppCombobox } from "@/components/forms";
import { customersService } from "@/features/customers/services/customers.service";
import { useLocale } from "@/providers/locale-provider";

/** Form-bound customer search (`customer_uuid`). */
export function CustomerField({ name = "customer_uuid" }: { name?: string }) {
  const { t } = useLocale();
  const loadCustomers = useCallback(async (query: string) => {
    const result = await customersService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
    });
    return result.items.map((c) => ({
      value: c.uuid,
      label: c.phone ? `${c.name} · ${c.phone}` : c.name,
    }));
  }, []);
  return (
    <AppCombobox
      name={name}
      label={t("loyalty.fields.customer")}
      loadOptions={loadCustomers}
      placeholder={t("loyalty.fields.pick_customer")}
      searchPlaceholder={t("loyalty.fields.search_customer")}
      emptyText={t("loyalty.fields.no_customers")}
    />
  );
}
