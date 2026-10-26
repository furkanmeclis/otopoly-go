import { Suspense } from "react";

import { ConsentScreen } from "@/features/mcp";

export const dynamic = "force-dynamic";

/** OAuth consent of MCP clients: `/oauth/consent?request=<uuid>`. */
export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <ConsentScreen />
    </Suspense>
  );
}
