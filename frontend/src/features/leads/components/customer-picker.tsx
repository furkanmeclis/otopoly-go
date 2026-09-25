"use client";

import { Plus, UserPlus } from "lucide-react";
import { useCallback, useState } from "react";

import {
  AsyncCombobox,
  type ComboboxOption,
} from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCustomerMutations } from "@/features/customers/hooks/use-customers";
import { customersService } from "@/features/customers/services/customers.service";
import { useLocale } from "@/providers/locale-provider";

export type PickedCustomer = { uuid: string; name: string; phone?: string };

function customerLabel(c: { name: string; phone?: string }) {
  return c.phone ? `${c.name} · ${c.phone}` : c.name;
}

/**
 * Async customer search with inline "new customer" (name + phone). Shared by
 * the lead dialog and the quote editor.
 */
export function CustomerPicker({
  value,
  onChange,
  initial,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (customer: PickedCustomer | null) => void;
  /** Label for an already selected customer (edit mode / prefill). */
  initial?: PickedCustomer | null;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const mutations = useCustomerMutations();
  const [known, setKnown] = useState<Record<string, PickedCustomer>>(() =>
    initial ? { [initial.uuid]: initial } : {},
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadCustomers = useCallback(async (query: string) => {
    const result = await customersService.list({
      limit: 20,
      offset: 0,
      q: query.trim() || undefined,
      is_active: "true",
    });
    setKnown((prev) => {
      const next = { ...prev };
      for (const c of result.items)
        next[c.uuid] = { uuid: c.uuid, name: c.name, phone: c.phone };
      return next;
    });
    return result.items.map((c): ComboboxOption => ({
      value: c.uuid,
      label: customerLabel(c),
    }));
  }, []);

  const options: ComboboxOption[] = Object.values(known).map((c) => ({
    value: c.uuid,
    label: customerLabel(c),
  }));

  const create = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t("leads.customer.name_required"));
      return;
    }
    try {
      const created = await mutations.create.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || undefined,
        kind: "individual",
        is_active: true,
      });
      const picked = {
        uuid: created.uuid,
        name: created.name,
        phone: created.phone,
      };
      setKnown((prev) => ({ ...prev, [picked.uuid]: picked }));
      onChange(picked);
      setName("");
      setPhone("");
      setCreating(false);
    } catch {
      /* toast from mutation */
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <AsyncCombobox
          value={value}
          onValueChange={(uuid) =>
            onChange(uuid ? (known[uuid] ?? null) : null)
          }
          loadOptions={loadCustomers}
          options={options}
          placeholder={t("leads.customer.pick")}
          searchPlaceholder={t("leads.customer.search")}
          emptyText={t("leads.customer.empty")}
          className="min-w-0 flex-1"
          aria-invalid={invalid}
          disabled={disabled}
        />
        <Button
          type="button"
          variant={creating ? "secondary" : "outline"}
          size="icon"
          onClick={() => setCreating((v) => !v)}
          aria-label={t("leads.customer.new")}
          title={t("leads.customer.new")}
          disabled={disabled}
        >
          <UserPlus className="size-4" />
        </Button>
      </div>
      {creating ? (
        <div className="bg-muted/40 grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("leads.customer.name")}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("leads.customer.phone")}
            inputMode="tel"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-9"
            disabled={mutations.create.isPending}
            onClick={() => void create()}
          >
            <Plus className="size-4" />
            {mutations.create.isPending
              ? t("common.saving")
              : t("leads.customer.save")}
          </Button>
          {error ? (
            <p className="text-destructive text-xs sm:col-span-3">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
