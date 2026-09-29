import { request } from "@/api/client";
import type { components } from "@/api/generated/api";
import type { Tokens } from "@/api/session";

type Schemas = components["schemas"];

export type Me = Schemas["Me"];
export type OrganizationMembership = Schemas["OrganizationMembership"];
export type LoginInput = Schemas["LoginRequest"];
export type PatchProfileInput = Schemas["PatchProfileRequest"];
export type ChangePasswordInput = Schemas["ChangePasswordRequest"];
export type TOTPStatus = Schemas["TOTPStatus"];

export type DeviceSession = {
  uuid: string;
  current: boolean;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at: string;
  expires_at: string;
  impersonated: boolean;
};

export type PublicOrganization = {
  uuid: string;
  slug: string;
  name: string;
  logo_url?: string | null;
  access_ok: boolean;
};

/**
 * Mobile auth talks to the Go API directly with Bearer tokens (the web uses the BFF + cookies),
 * so refresh/logout send the refresh token in the body.
 */
export const authService = {
  login(body: LoginInput) {
    return request<Tokens>("POST", "/v1/auth/login", { body, anonymous: true, silent: true });
  },
  refresh(refreshToken: string) {
    return request<Tokens>("POST", "/v1/auth/refresh", {
      body: { refresh_token: refreshToken },
      anonymous: true,
      silent: true,
    });
  },
  switchOrganizationContext(organizationSlug: string) {
    return request<Tokens>("POST", "/v1/auth/organization-context", {
      body: { organization_slug: organizationSlug },
      silent: true,
    });
  },
  logout(refreshToken: string) {
    return request<{ status: string }>("POST", "/v1/auth/logout", {
      body: { refresh_token: refreshToken },
      silent: true,
    });
  },
  getMe() {
    return request<Me>("GET", "/v1/auth/me", { silent: true });
  },
  updateProfile(body: PatchProfileInput) {
    return request<Me>("PATCH", "/v1/auth/profile", { body });
  },
  changePassword(body: ChangePasswordInput) {
    return request<{ status: string }>("POST", "/v1/auth/password/change", { body });
  },
  forgotPassword(email: string) {
    return request<{ status: string }>("POST", "/v1/auth/password/forgot", {
      body: { email },
      anonymous: true,
      silent: true,
    });
  },
  organizationBySlug(slug: string) {
    return request<PublicOrganization>("GET", `/v1/public/organizations/by-slug/${encodeURIComponent(slug)}`, {
      anonymous: true,
      silent: true,
    });
  },
  listSessions() {
    return request<{ items: DeviceSession[] }>("GET", "/v1/auth/sessions");
  },
  revokeSession(uuid: string) {
    return request<{ status: string }>("DELETE", `/v1/auth/sessions/${uuid}`);
  },
  revokeOtherSessions() {
    return request<{ status: string }>("POST", "/v1/auth/sessions/revoke-others");
  },
  getTOTPStatus() {
    return request<TOTPStatus>("GET", "/v1/auth/totp");
  },
};
