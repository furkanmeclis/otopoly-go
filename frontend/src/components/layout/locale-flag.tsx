import type { ComponentType, SVGProps } from "react";

import type { AppLocale } from "@/config/i18n";
import { cn } from "@/lib/utils";

type FlagProps = SVGProps<SVGSVGElement>;

function TurkeyFlag(props: FlagProps) {
  return (
    <svg viewBox="0 0 512 512" {...props}>
      <rect width="512" height="512" fill="#e30a17" />
      <circle cx="232" cy="256" r="112" fill="#fff" />
      <circle cx="260" cy="256" r="90" fill="#e30a17" />
      <path
        fill="#fff"
        d="M310 256l31-10.9.8-32.8 19.9 26.1 31.5-9.4-18.7 27 18.7 27-31.5-9.4-19.9 26.1-.8-32.8z"
      />
    </svg>
  );
}

function UnitedKingdomFlag(props: FlagProps) {
  return (
    <svg viewBox="0 0 512 512" {...props}>
      <rect width="512" height="512" fill="#012169" />
      <path d="M0 0l512 512M512 0L0 512" stroke="#fff" strokeWidth="96" />
      <path d="M0 0l512 512M512 0L0 512" stroke="#c8102e" strokeWidth="32" />
      <path d="M256 0v512M0 256h512" stroke="#fff" strokeWidth="160" />
      <path d="M256 0v512M0 256h512" stroke="#c8102e" strokeWidth="96" />
    </svg>
  );
}

const flags: Record<AppLocale, ComponentType<FlagProps>> = {
  tr: TurkeyFlag,
  en: UnitedKingdomFlag,
};

/** Circular SVG flag for a UI locale. */
export function LocaleFlag({
  locale,
  className,
  ...props
}: FlagProps & { locale: AppLocale }) {
  const Flag = flags[locale];
  return (
    <Flag
      aria-hidden
      className={cn(
        "ring-border size-5 shrink-0 overflow-hidden rounded-full ring-1",
        className,
      )}
      {...props}
    />
  );
}
