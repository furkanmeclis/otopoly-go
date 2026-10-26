import type { SVGProps } from "react";

/** Generic SMS channel mark: a speech bubble with three dots. */
export function SmsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        d="M4 3h16a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7.6L7 21.6c-.6.4-1.4 0-1.4-.7V18H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"
        fill="currentColor"
      />
      <circle cx="7.5" cy="10.5" r="1.4" fill="#fff" />
      <circle cx="12" cy="10.5" r="1.4" fill="#fff" />
      <circle cx="16.5" cy="10.5" r="1.4" fill="#fff" />
    </svg>
  );
}
