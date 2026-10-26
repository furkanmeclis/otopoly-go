import type { components } from "@/generated/api";
import { apiClient, unwrap } from "@/lib/api";

export type McpInfo = components["schemas"]["MCPInfo"];
export type McpConsent = components["schemas"]["MCPConsent"];
export type McpConsentOrganization =
  components["schemas"]["MCPConsentOrganization"];
export type McpDecideRequest = components["schemas"]["MCPDecideRequest"];
export type McpGrant = components["schemas"]["MCPGrant"];
export type McpClient = components["schemas"]["MCPClient"];

export type McpScope = "mcp:read" | "mcp:write";

export type McpGrantListParams = {
  limit: number;
  offset: number;
  q?: string;
  realm?: "org" | "platform";
  organization_uuid?: string;
};

export type McpClientListParams = {
  limit: number;
  offset: number;
  q?: string;
  status?: "active" | "revoked";
};

type Page<T> = { items: T[]; total: number; limit: number; offset: number };

export const mcpService = {
  async info() {
    return unwrap<McpInfo>(await apiClient.GET("/v1/mcp/info"));
  },

  async consent(uuid: string) {
    return unwrap<McpConsent>(
      await apiClient.GET("/v1/mcp/oauth/requests/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },

  async decide(uuid: string, body: McpDecideRequest) {
    return unwrap<{ redirect_url: string }>(
      await apiClient.POST("/v1/mcp/oauth/requests/{uuid}/decide", {
        params: { path: { uuid } },
        body,
      }),
    );
  },

  async listGrants(params: McpGrantListParams) {
    return unwrap<Page<McpGrant>>(
      await apiClient.GET("/v1/mcp/grants", { params: { query: params } }),
    );
  },

  async revokeGrant(uuid: string) {
    await unwrap<void>(
      await apiClient.DELETE("/v1/mcp/grants/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },

  async listClients(params: McpClientListParams) {
    return unwrap<Page<McpClient>>(
      await apiClient.GET("/v1/platform/mcp/clients", {
        params: { query: params },
      }),
    );
  },

  async revokeClient(uuid: string) {
    await unwrap<void>(
      await apiClient.DELETE("/v1/platform/mcp/clients/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },
};
