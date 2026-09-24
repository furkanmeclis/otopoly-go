import { ogAlt, ogSize } from "@/features/landing/og/meta";
import { renderOgImage } from "@/features/landing/og/render";

// Prerendered to a static PNG during `next build` (no request-time inputs).
export const dynamic = "force-static";
export const alt = ogAlt;
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage();
}
