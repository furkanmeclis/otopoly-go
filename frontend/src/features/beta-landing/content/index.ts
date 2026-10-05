import { en } from "./en";
import { tr } from "./tr";
import type { BetaLandingContent } from "./types";
import type { LandingLocale } from "@/features/landing/content";

export type * from "./types";

export function getBetaLandingContent(
  locale: LandingLocale,
): BetaLandingContent {
  return locale === "en" ? en : tr;
}
