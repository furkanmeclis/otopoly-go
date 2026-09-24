import { cn } from "@/lib/utils";

/** Turkish licence plate look-alike: blue TR strip + monospace plate. */
export function PlateBadge({
  plate,
  size = "md",
  className,
}: {
  plate: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-[5px] border border-neutral-900/80 bg-white font-mono font-semibold whitespace-nowrap text-neutral-900 shadow-xs dark:border-neutral-200/70",
        size === "sm" ? "text-[11px]" : "text-[13px]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-end bg-[#0B4DA2] font-sans font-bold text-white",
          size === "sm"
            ? "px-[3px] pb-px text-[6px]"
            : "px-1 pb-0.5 text-[7px]",
        )}
      >
        TR
      </span>
      <span
        className={cn(
          "tracking-wide",
          size === "sm" ? "px-1.5 py-px" : "px-2 py-0.5",
        )}
      >
        {plate}
      </span>
    </span>
  );
}
