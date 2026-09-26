"use client";

import { useState } from "react";

import { apiConfig } from "@/config/api";
import { assertServiceMediaURL } from "@/lib/media/urls";
import { cn } from "@/lib/utils";

/**
 * Vehicle brand logo next to the plate; falls back to the brand initial when
 * no logo is uploaded (or it fails to load).
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
  const [failed, setFailed] = useState(false);
  const name = brandName?.trim() ?? "";
  const path = assertServiceMediaURL(logoUrl);
  const src =
    path && !failed
      ? path.startsWith("/")
        ? `${apiConfig.baseUrl.replace(/\/$/, "")}${path}`
        : path
      : null;

  if (!src && !name) return null;

  return (
    <span
      title={name || undefined}
      className={cn(
        "grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border bg-white",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full object-contain p-0.5"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[10px] font-semibold text-neutral-600">
          {name.charAt(0).toLocaleUpperCase("tr-TR")}
        </span>
      )}
    </span>
  );
}
