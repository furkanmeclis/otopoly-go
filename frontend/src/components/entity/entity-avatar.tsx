"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const palette = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toLocaleUpperCase("tr-TR");
}

function hueIndex(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1)
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % palette.length;
}

/**
 * Identity mark of a detail page header: the record's image when the API
 * returns one, else a stable coloured tile with the initials (or an icon).
 */
export function EntityAvatar({
  name,
  imageUrl,
  icon: Icon,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  icon?: LucideIcon;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const tone = palette[hueIndex(name || "?")];
  return (
    <span
      className={cn(
        "grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border",
        imageUrl && !failed ? "bg-white" : tone,
        className,
      )}
      aria-hidden
    >
      {imageUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="size-full object-contain p-1"
          onError={() => setFailed(true)}
        />
      ) : Icon ? (
        <Icon className="size-6" />
      ) : (
        <span className="font-display text-lg font-semibold">
          {initials(name) || "?"}
        </span>
      )}
    </span>
  );
}
