import type { SVGProps } from "react";

/**
 * Netgsm mark: rounded square with an "n" and a signal arc (brand blue via
 * `text-[#0057B8]`; the glyph is drawn in white).
 */
export function NetgsmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect width="24" height="24" rx="5.5" fill="currentColor" />
      <path
        d="M6.5 17.5V10.2c0-.9.7-1.6 1.6-1.6h3.3c2.2 0 3.6 1.4 3.6 3.6v5.3"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.6 5.2a4.6 4.6 0 0 1 3.2 3.2"
        fill="none"
        stroke="#FF8A00"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
