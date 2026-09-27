import { getLandingContent } from "@/features/landing/content";
import { ogSize } from "@/features/landing/og/meta";
import { renderOgImage } from "@/features/landing/og/render";

// English share card for /en, prerendered to a static PNG at build time.
export const dynamic = "force-static";
export const alt = getLandingContent("en").meta.title;
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return renderOgImage("en");
}
