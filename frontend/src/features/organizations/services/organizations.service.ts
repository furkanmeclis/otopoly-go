import type { ServerListParams } from "@/components/entity";
import { apiConfig } from "@/config/api";
import { platformFormRequest } from "@/lib/api/platform-form-request";
import type { components } from "@/generated/api";
import { apiClient, platformRequest, unwrap } from "@/lib/api";

export type OrganizationStatus = "pending" | "active" | "suspended" | "expired";

export type OrganizationSummary = {
  uuid: string;
  slug: string;
  name: string;
  role: string;
  logo_url?: string | null;
  status: string;
  access_ends_at?: string | null;
};

export type PublicOrganization = {
  uuid: string;
  slug: string;
  name: string;
  status: string;
  logo_url?: string | null;
  access_ok: boolean;
};

export type Organization = {
  uuid: string;
  slug: string;
  name: string;
  city: string;
  district: string;
  phone: string;
  address: string;
  status: OrganizationStatus;
  plan_code?: string | null;
  access_starts_at: string;
  access_ends_at?: string | null;
  logo_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationMemberRole = "owner" | "staff";

export type OrganizationMember = {
  uuid: string;
  email: string;
  name: string;
  surname: string;
  status: string;
  role: string;
  created_at?: string;
};

export type OrganizationDetail = {
  organization: Organization;
  members: OrganizationMember[];
};

export type OrganizationListResult = {
  items: Organization[];
  total: number;
  limit: number;
  offset: number;
};

export type ListOrganizationsParams = ServerListParams & {
  status?: string;
};

export type CreatePlatformOrganizationRequest = {
  name: string;
  city: string;
  district: string;
  phone: string;
  address: string;
  owner_user_uuid: string;
};

export type PatchPlatformOrganizationRequest = {
  name?: string;
  city?: string;
  district?: string;
  phone?: string;
  address?: string;
  status?: OrganizationStatus;
  plan_code?: string;
  access_ends_at?: string;
  clear_access_ends_at?: boolean;
};

export type OrganizationRegisterInput = {
  name: string;
  surname: string;
  email: string;
  password: string;
  organization_name: string;
  city: string;
  district: string;
  phone: string;
  address: string;
};

export type OrganizationRegisterResult = {
  user: {
    uuid: string;
    email: string;
    name: string;
    surname: string;
  };
  organization: Organization;
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
};

export type ResourceMeta = {
  resource?: string;
  capabilities?: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
    search?: boolean;
    filter?: boolean;
    sort?: boolean;
    export?: boolean;
    import?: boolean;
    bulk?: boolean;
  };
};

async function publicRequest<T>(method: string, path: string, body?: unknown) {
  const base = apiConfig.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => undefined);
  return unwrap<T>({ data: payload, response });
}

type Schemas = components["schemas"];

export type OrganizationOverview = Schemas["OrganizationOverview"];
export type OrganizationStats = Schemas["OrganizationStats"];
export type OrganizationBilling = Schemas["OrganizationBilling"];
export type OrganizationWhatsAppOverview =
  Schemas["OrganizationWhatsAppOverview"];
export type OrganizationActivityEntry = Schemas["OrganizationActivityEntry"];
export type OrganizationOutboundMessage = Schemas["OutboundMessage"];
export type SetOrganizationStatusRequest =
  Schemas["SetOrganizationStatusRequest"];
export type ExtendOrganizationAccessRequest =
  Schemas["ExtendOrganizationAccessRequest"];

export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type OrganizationActivityParams = ServerListParams & {
  action?: string;
};

export type OwnedOrganizationCreated =
  components["schemas"]["OwnedOrganizationCreated"];

export const organizationsService = {
  /**
   * Signed-in user without a business creates one and becomes its owner.
   * Goes through the BFF (bearer from the session cookie). Silent: the
   * onboarding wizard shows its own messages per status.
   */
  async createOwned(
    body: components["schemas"]["CreateOwnedOrganizationRequest"],
  ) {
    return unwrap<OwnedOrganizationCreated>(
      await apiClient.POST("/v1/auth/organizations", { body }),
      { silent: true },
    );
  },

  async register(body: OrganizationRegisterInput) {
    return publicRequest<OrganizationRegisterResult>(
      "POST",
      "/v1/public/organizations/register",
      body,
    );
  },

  async getPublicBySlug(slug: string) {
    return publicRequest<PublicOrganization>(
      "GET",
      `/v1/public/organizations/by-slug/${encodeURIComponent(slug)}`,
    );
  },

  async list(params: ListOrganizationsParams) {
    return platformRequest<OrganizationListResult>(
      "GET",
      "/v1/platform/organizations",
      {
        query: {
          limit: params.limit,
          offset: params.offset,
          sort: params.sort,
          q: params.q,
          status: params.status,
        },
      },
    );
  },

  async meta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/platform/organizations/meta",
    );
  },

  async get(uuid: string) {
    return platformRequest<OrganizationDetail>(
      "GET",
      `/v1/platform/organizations/${uuid}`,
    );
  },

  async create(body: CreatePlatformOrganizationRequest) {
    return platformRequest<Organization>("POST", "/v1/platform/organizations", {
      body,
    });
  },

  async update(uuid: string, body: PatchPlatformOrganizationRequest) {
    return platformRequest<Organization>(
      "PATCH",
      `/v1/platform/organizations/${uuid}`,
      { body },
    );
  },

  async uploadLogo(uuid: string, file: File) {
    const form = new FormData();
    form.append("logo", file);
    return platformFormRequest<Organization>(
      "PUT",
      `/v1/platform/organizations/${uuid}/logo`,
      form,
    );
  },

  async deleteLogo(uuid: string) {
    return platformRequest<Organization>(
      "DELETE",
      `/v1/platform/organizations/${uuid}/logo`,
    );
  },

  async addMember(uuid: string, body: { user_uuid: string; role?: string }) {
    return platformRequest<{ status: string }>(
      "POST",
      `/v1/platform/organizations/${uuid}/members`,
      { body },
    );
  },

  async updateMemberRole(
    uuid: string,
    userUuid: string,
    role: OrganizationMemberRole,
  ) {
    return platformRequest<OrganizationMember>(
      "PATCH",
      `/v1/platform/organizations/${uuid}/members/${userUuid}`,
      { body: { role } },
    );
  },

  /** 360° overview: stats, billing (plan, usage vs limits), WhatsApp summary. */
  async overview(uuid: string) {
    return platformRequest<OrganizationOverview>(
      "GET",
      `/v1/platform/organizations/${uuid}/overview`,
    );
  },

  async activity(uuid: string, params: OrganizationActivityParams) {
    return platformRequest<Page<OrganizationActivityEntry>>(
      "GET",
      `/v1/platform/organizations/${uuid}/activity`,
      {
        query: {
          limit: params.limit,
          offset: params.offset,
          q: params.q,
          action: params.action,
        },
      },
    );
  },

  async outbound(uuid: string, params: ServerListParams) {
    return platformRequest<Page<OrganizationOutboundMessage>>(
      "GET",
      `/v1/platform/organizations/${uuid}/whatsapp/outbound`,
      { query: { limit: params.limit, offset: params.offset } },
    );
  },

  /** Suspend / activate. Step-up is retried by platformRequest. */
  async setStatus(uuid: string, body: SetOrganizationStatusRequest) {
    return platformRequest<Organization>(
      "POST",
      `/v1/platform/organizations/${uuid}/status`,
      { body },
    );
  },

  /** Extend access by N days. Step-up is retried by platformRequest. */
  async extendAccess(uuid: string, body: ExtendOrganizationAccessRequest) {
    return platformRequest<Organization>(
      "POST",
      `/v1/platform/organizations/${uuid}/extend-access`,
      { body },
    );
  },

  async removeMember(uuid: string, userUuid: string) {
    return platformRequest<{ status: string }>(
      "DELETE",
      `/v1/platform/organizations/${uuid}/members/${userUuid}`,
    );
  },
};
