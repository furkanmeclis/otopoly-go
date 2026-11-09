import type { SVGProps } from "react";

import type { BrandTone } from "@/config/brand";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

import { brandMark } from "./artwork";
import { brandShapes, themedPaint } from "./brand-shapes";

type AppMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  /** `auto` follows the theme; `light` / `dark` pin the variant for fixed backgrounds. */
  tone?: BrandTone;
};

/** OP mark — espresso O tile + terracotta P tile (O tile outlined on dark). */
export function AppMark({
  className,
  title = brand.name,
  tone = "auto",
  ...props
}: AppMarkProps) {
  return (
    <svg
      viewBox={brandMark.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      data-tone={tone === "auto" ? undefined : tone}
      className={cn("brand-logo size-8", className)}
      {...props}
    >
      <title>{title}</title>
      {brandShapes(brandMark, themedPaint)}
    </svg>
  );
}
