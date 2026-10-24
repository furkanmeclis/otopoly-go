"use client";

import { BrandMark } from "@/components/common/brand-mark";

/**
 * Vehicle brand badge next to the plate; falls back to the brand initial
 * when no logo is available. Thin wrapper kept for the job board / table.
 */
export function VehicleBrandMark({
  brandName,
  logoUrl,
  className,
}: {
  brandName?: string | null;
  logoUrl?: string | null;
  className?: string;
}) {
  return <BrandMark name={brandName} logoUrl={logoUrl} className={className} />;
}
