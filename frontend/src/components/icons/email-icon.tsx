import type { SVGProps } from "react";

/** E-mail channel mark: an envelope (color via `text-*`). */
export function EmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="1.5" y="4" width="21" height="16" rx="3" fill="currentColor" />
      <path
        d="m4.5 7.5 7.5 5.5 7.5-5.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
