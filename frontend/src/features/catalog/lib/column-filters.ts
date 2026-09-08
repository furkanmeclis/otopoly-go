import type { ColumnFiltersState } from "@tanstack/react-table";

export function columnSelectValue(columnFilters: ColumnFiltersState, id: string) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  if (Array.isArray(raw)) {
    return typeof raw[0] === "string" && raw[0] ? raw[0] : undefined;
  }
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function columnTextValue(columnFilters: ColumnFiltersState, id: string) {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
