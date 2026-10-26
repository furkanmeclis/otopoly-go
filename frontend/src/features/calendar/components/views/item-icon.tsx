import type { LucideIcon } from "lucide-react";
import { createElement } from "react";

import { cn } from "@/lib/utils/index";

/** Renders an item's optional leading icon from a static reference. */
export function ItemIcon({
  icon,
  className,
}: {
  icon?: LucideIcon;
  className?: string;
}) {
  if (!icon) return null;
  return createElement(icon, {
    "aria-hidden": true,
    className: cn("size-3 shrink-0", className),
  });
}
