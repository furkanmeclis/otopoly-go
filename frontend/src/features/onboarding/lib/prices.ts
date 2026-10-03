import type { StarterService } from "@/features/onboarding/data/starter-services";

/** "1.400" / "1400,50" → "1400.50" (API decimal). */
export function normalizePrice(raw: string): string {
  const cleaned = raw.replace(/[^\d,.]/g, "");
  const lastSep = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  if (lastSep === -1) return cleaned;
  const decimals = cleaned.slice(lastSep + 1);
  // A 3-digit tail after the only separator is a thousands separator.
  if (decimals.length === 3) return cleaned.replace(/[.,]/g, "");
  return `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${decimals}`;
}

/** Selected, named starter services as catalog create payloads. */
export function starterServicePayloads(services: StarterService[]) {
  return services
    .filter((s) => s.selected && s.name.trim())
    .map((s) => ({
      name: s.name.trim(),
      price: normalizePrice(s.price) || "0",
      currency: "TRY",
      is_active: true,
    }));
}
