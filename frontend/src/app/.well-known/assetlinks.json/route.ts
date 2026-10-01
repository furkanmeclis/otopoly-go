import {
  androidFingerprints,
  assetLinks,
  associationResponse,
} from "@/lib/server/app-links";

// Runtime env (ANDROID_SHA256_CERT_FINGERPRINTS), never prerendered.
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = androidFingerprints();
  if (fingerprints.length === 0) {
    return associationResponse(
      { error: "ANDROID_SHA256_CERT_FINGERPRINTS not configured" },
      404,
    );
  }
  return associationResponse(assetLinks(fingerprints));
}
