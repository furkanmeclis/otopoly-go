import { en } from "./en";
import { tr } from "./tr";
import type { LandingContent, LandingLocale } from "./types";

export type * from "./types";

export function getLandingContent(locale: LandingLocale): LandingContent {
  return locale === "en" ? en : tr;
}

/** Replaces {{name}} placeholders in landing copy. */
export function fill(
  text: string,
  params: Record<string, string | number>,
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
    String(params[k] ?? ""),
  );
}
