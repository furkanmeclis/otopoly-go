/**
 * SMS length / part estimate. Mirrors `backend/internal/platform/sms/segments.go`
 * (also served by `POST /v1/tenant/messaging/sms/estimate`).
 */

export type SegmentProvider = "netgsm" | "twilio";
export type SmsEncoding = "gsm7" | "turkish" | "ucs2";

export interface SmsSegmentEstimate {
  encoding: SmsEncoding;
  characters: number;
  segments: number;
  per_segment: number;
  remaining: number;
}

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";
const TURKISH_ONLY = "çğĞıİşŞ";

const PART_SIZES: Record<SmsEncoding, [number, number]> = {
  gsm7: [160, 153],
  turkish: [155, 150],
  ucs2: [70, 67],
};

export function estimateSms(
  body: string,
  provider: SegmentProvider = "netgsm",
): SmsSegmentEstimate {
  let encoding: SmsEncoding = "gsm7";
  let characters = 0;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) {
      characters += 1;
    } else if (GSM_EXTENDED.includes(ch)) {
      characters += 2;
    } else if (TURKISH_ONLY.includes(ch) && provider === "netgsm") {
      if (encoding === "gsm7") encoding = "turkish";
      characters += 1;
    } else {
      encoding = "ucs2";
    }
  }
  if (encoding === "ucs2") {
    // UTF-16 code units (emoji count twice).
    characters = body.length;
  }
  const [single, multi] = PART_SIZES[encoding];
  if (characters === 0) {
    return {
      encoding,
      characters,
      segments: 0,
      per_segment: single,
      remaining: single,
    };
  }
  if (characters <= single) {
    return {
      encoding,
      characters,
      segments: 1,
      per_segment: single,
      remaining: single - characters,
    };
  }
  const segments = Math.ceil(characters / multi);
  return {
    encoding,
    characters,
    segments,
    per_segment: multi,
    remaining: segments * multi - characters,
  };
}
