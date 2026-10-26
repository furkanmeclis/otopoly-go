"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * URL-synced tab (`?tab=`) of a detail page so other screens can deep-link
 * (e.g. `/catalog/products/{uuid}?tab=movements`). The first tab is the
 * default and is kept out of the URL.
 */
export function useDetailTab<T extends string>(
  tabs: readonly T[],
): [T, (next: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const current = (tabs as readonly string[]).includes(raw ?? "")
    ? (raw as T)
    : tabs[0];
  const select = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === tabs[0]) params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, tabs],
  );
  return [current, select];
}

export type EntityTabItem = {
  value: string;
  label: string;
  /** Optional count next to the label. */
  badge?: number | null;
  hidden?: boolean;
};

/** Tab strip of a detail page; scrolls sideways on narrow screens. */
export function EntityTabsList({ items }: { items: EntityTabItem[] }) {
  return (
    <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
      <TabsList>
        {items
          .filter((item) => !item.hidden)
          .map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="gap-1.5"
            >
              {item.label}
              {item.badge != null && item.badge > 0 ? (
                <Badge
                  variant="secondary"
                  className="h-4 min-w-4 px-1 text-[10px] font-normal tabular-nums"
                >
                  {item.badge}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
      </TabsList>
    </div>
  );
}
