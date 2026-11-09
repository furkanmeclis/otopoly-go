import type { SVGProps } from "react";

import type { BrandTone } from "@/config/brand";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

import { brandWordmark } from "./artwork";
import { brandShapes, themedPaint } from "./brand-shapes";

type AppWordmarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  /** `auto` follows the theme; `light` / `dark` pin the variant for fixed backgrounds. */
  tone?: BrandTone;
};

/** Horizontal lockup — OP mark + OTOPOLY. */
export function AppWordmark({
  className,
  title = brand.productName,
  tone = "auto",
  ...props
}: AppWordmarkProps) {
  return (
    <svg
      viewBox={brandWordmark.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      data-tone={tone === "auto" ? undefined : tone}
      className={cn("brand-logo h-9 w-auto", className)}
      {...props}
    >
      <title>{title}</title>
      {brandShapes(brandWordmark, themedPaint)}
    </svg>
  );
}
