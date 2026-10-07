import type { ServerListParams } from "@/components/entity";
import type { components } from "@/generated/api";
import { platformRequest } from "@/lib/api/platform-request";
import type { RoleSummary } from "@/features/roles/services/roles.service";

export type UserAuthMethod = {
  kind: "password" | "passkey" | "oauth";
  provider?: string;
  label?: string | null;
  linked_at: string;
};

export type PublicUser = {
  uuid: string;
  email: string;
  name: string;
  surname: string;
  status: string;
  is_super_admin: boolean;
  email_verified: boolean;
  /** Set when a platform admin deleted the user (soft delete). */
  deleted_at?: string | null;
  roles?: RoleSummary[];
  auth_methods?: UserAuthMethod[];
};

export type PlatformUserDetail = PublicUser & {
  roles: RoleSummary[];
  auth_methods: UserAuthMethod[];
};

export type CreatePlatformUserRequest = {
  email: string;
  password: string;
  name: string;
  surname: string;
  status?: string;
  role_uuids?: string[];
};

export type PatchPlatformUserRequest = {
  name?: string;
  surname?: string;
  status?: string;
  role_uuids?: string[];
};

export type SetPlatformUserPasswordRequest = {
  password: string;
};

export type SessionSwitch = {
  user_uuid: string;
  email: string;
  impersonator_uuid?: string;
};

export type ImpersonationResult = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_at: string;
  session: SessionSwitch;
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
  sortable?: string[];
  filterable?: string[];
};

export type StatusPayload = {
  status: string;
};

export type UserListResult = {
  items: PublicUser[];
  total: number;
  limit: number;
  offset: number;
};

export type ListUsersParams = ServerListParams & {
  status?: string;
  role?: string;
};

export type UserStatus = "active" | "pending" | "disabled";

/** List filter value: `deleted` lists soft-deleted users instead of live ones. */
export type UserListStatus = UserStatus | "deleted";

type Schemas = components["schemas"];

export type PlatformUserOverview = Schemas["PlatformUserOverview"];
export type UserAIUsage = Schemas["UserAIUsage"];
export type UserMembership = Schemas["UserMembership"];
export type UserSession = Schemas["UserSession"];
export type UserPushDevice = Schemas["UserPushDevice"];
export type UserActivityEntry = Schemas["UserActivityEntry"];

export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type UserActivityParams = ServerListParams & {
  organization_uuid?: string;
  action?: string;
};

function pageQuery(params: ServerListParams) {
  return { limit: params.limit, offset: params.offset };
}

export const usersService = {
  async list(params: ListUsersParams) {
    return platformRequest<UserListResult>("GET", "/v1/platform/users", {
      query: {
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
        q: params.q,
        status: params.status,
        role: params.role,
      },
    });
  },

  async meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/platform/users/meta");
  },

  async get(uuid: string) {
    return platformRequest<PlatformUserDetail>(
      "GET",
      `/v1/platform/users/${uuid}`,
    );
  },

  async create(body: CreatePlatformUserRequest) {
    return platformRequest<PublicUser>("POST", "/v1/platform/users", { body });
  },

  async update(uuid: string, body: PatchPlatformUserRequest) {
    return platformRequest<PublicUser>("PATCH", `/v1/platform/users/${uuid}`, {
      body,
    });
  },

  async setPassword(uuid: string, body: SetPlatformUserPasswordRequest) {
    return platformRequest<StatusPayload>(
      "POST",
      `/v1/platform/users/${uuid}/password`,
      { body },
    );
  },

  async remove(uuid: string) {
    return platformRequest<PublicUser>("DELETE", `/v1/platform/users/${uuid}`);
  },

  async restore(uuid: string) {
    return platformRequest<PublicUser>(
      "POST",
      `/v1/platform/users/${uuid}/restore`,
    );
  },

  async impersonate(uuid: string) {
    return platformRequest<ImpersonationResult>(
      "POST",
      `/v1/platform/users/${uuid}/impersonate`,
    );
  },

  async overview(uuid: string) {
    return platformRequest<PlatformUserOverview>(
      "GET",
      `/v1/platform/users/${uuid}/overview`,
    );
  },

  async organizations(uuid: string, params: ServerListParams) {
    return platformRequest<Page<UserMembership>>(
      "GET",
      `/v1/platform/users/${uuid}/organizations`,
      { query: pageQuery(params) },
    );
  },

  async sessions(uuid: string, params: ServerListParams) {
    return platformRequest<Page<UserSession>>(
      "GET",
      `/v1/platform/users/${uuid}/sessions`,
      { query: pageQuery(params) },
    );
  },

  /** Step-up is retried by platformRequest. */
  async revokeSession(uuid: string, sessionUuid: string) {
    return platformRequest<StatusPayload>(
      "DELETE",
      `/v1/platform/users/${uuid}/sessions/${sessionUuid}`,
    );
  },

  /** Step-up is retried by platformRequest. */
  async revokeAllSessions(uuid: string) {
    return platformRequest<StatusPayload & { revoked: number }>(
      "POST",
      `/v1/platform/users/${uuid}/sessions/revoke-all`,
    );
  },

  async devices(uuid: string, params: ServerListParams) {
    return platformRequest<Page<UserPushDevice>>(
      "GET",
      `/v1/platform/users/${uuid}/devices`,
      { query: pageQuery(params) },
    );
  },

  /** Step-up is retried by platformRequest. */
  async removeDevice(uuid: string, deviceUuid: string) {
    return platformRequest<StatusPayload>(
      "DELETE",
      `/v1/platform/users/${uuid}/devices/${deviceUuid}`,
    );
  },

  async activity(uuid: string, params: UserActivityParams) {
    return platformRequest<Page<UserActivityEntry>>(
      "GET",
      `/v1/platform/users/${uuid}/activity`,
      {
        query: {
          ...pageQuery(params),
          q: params.q,
          organization_uuid: params.organization_uuid,
          action: params.action,
        },
      },
    );
  },
};
