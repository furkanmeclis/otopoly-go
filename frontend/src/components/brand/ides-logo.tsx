import { brand, type BrandTone, type BrandVariant } from "@/config/brand";
import { cn } from "@/lib/utils";

import { AppMark } from "./app-mark";
import { AppWordmark } from "./app-wordmark";

type AppLogoProps = {
  variant?: BrandVariant;
  tone?: BrandTone;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
};

/**
 * App lockup. `mark` / `icon` → OP mark; `logo` / `wordmark` → horizontal lockup.
 */
export function AppLogo({
  variant = "logo",
  tone = "auto",
  className,
  width,
  height,
}: AppLogoProps) {
  const compact = variant === "mark" || variant === "icon";

  if (compact) {
    return (
      <AppMark
        width={width}
        height={height}
        className={cn("size-4 shrink-0", className)}
        title={brand.name}
        tone={tone}
      />
    );
  }

  return (
    <AppWordmark
      width={width}
      height={height}
      className={className}
      title={brand.productName}
      tone={tone}
    />
  );
}

/** @deprecated Prefer AppLogo — kept for layout import compatibility. */
export const IdesLogo = AppLogo;
