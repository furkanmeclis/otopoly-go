import type { components } from "@/generated/api";
import { apiClient, unwrap } from "@/lib/api";

export type LegalPage = components["schemas"]["LegalPage"];
export type LegalPagePatch = components["schemas"]["PatchLegalPageRequest"];

export const legalService = {
  async get(slug: string) {
    return unwrap<LegalPage>(
      await apiClient.GET("/v1/platform/legal/{slug}", {
        params: { path: { slug } },
      }),
    );
  },

  async patch(slug: string, body: LegalPagePatch) {
    return unwrap<LegalPage>(
      await apiClient.PATCH("/v1/platform/legal/{slug}", {
        params: { path: { slug } },
        body,
      }),
    );
  },
};
