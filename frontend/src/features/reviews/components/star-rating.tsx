"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/** Read-only 1–5 star display (amber filled, muted empty). */
export function StarRating({
  score,
  size = "sm",
  className,
  label,
}: {
  score: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
  label?: string;
}) {
  if (score == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const cls = size === "md" ? "size-5" : "size-3.5";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={label ?? `${score}/5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(
            cls,
            i <= score
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}
