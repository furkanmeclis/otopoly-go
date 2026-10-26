import type { components } from "@/generated/api";
import { apiClient, unwrap } from "@/lib/api";

export type ApnsStatus = components["schemas"]["PlatformAPNsStatus"];
export type ApnsTestResult = components["schemas"]["PlatformAPNsTestResult"];
export type ApnsSaveBody = components["schemas"]["SavePlatformAPNsKeyRequest"];

const PATH = "/v1/platform/integrations/apple/apns";

export const apnsQueryKey = ["platform", "integrations", "apple", "apns"];

export const apnsService = {
  async get() {
    return unwrap<ApnsStatus>(await apiClient.GET(PATH));
  },
  async save(body: ApnsSaveBody) {
    return unwrap<ApnsStatus>(await apiClient.PUT(PATH, { body }));
  },
  async remove() {
    return unwrap<ApnsStatus>(await apiClient.DELETE(PATH));
  },
  async test() {
    return unwrap<ApnsTestResult>(
      await apiClient.POST("/v1/platform/integrations/apple/apns/test"),
    );
  },
};
