import {
  appleAppSiteAssociation,
  associationResponse,
  iosAppId,
} from "@/lib/server/app-links";

// Runtime env (APPLE_TEAM_ID), never prerendered.
export const dynamic = "force-dynamic";

export function GET() {
  const appId = iosAppId();
  if (!appId) {
    return associationResponse({ error: "APPLE_TEAM_ID not configured" }, 404);
  }
  return associationResponse(appleAppSiteAssociation(appId));
}
