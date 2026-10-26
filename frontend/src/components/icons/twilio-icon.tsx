import type { SVGProps } from "react";

/** Twilio mark: a ring with four dots (brand red via `text-[#F22F46]`). */
export function TwilioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm0 20.8a8.8 8.8 0 1 1 0-17.6 8.8 8.8 0 0 1 0 17.6Z" />
      <circle cx="8.9" cy="8.9" r="2.3" />
      <circle cx="15.1" cy="8.9" r="2.3" />
      <circle cx="8.9" cy="15.1" r="2.3" />
      <circle cx="15.1" cy="15.1" r="2.3" />
    </svg>
  );
}
