import { request } from '@/api/client';

/** Public bootstrap config (`GET /v1/app/config`); only the fields the app reads. */
export type AppConfig = {
  registration_enabled?: boolean;
  auth_methods?: Record<string, { login?: boolean; register?: boolean }>;
};

export type CreateOrganizationInput = {
  /** 2-120 characters. */
  organization_name: string;
  phone?: string;
  city?: string;
  district?: string;
  address?: string;
};

export type CreatedOrganization = { organization: { uuid: string; slug: string; name: string } };

export const onboardingService = {
  appConfig() {
    return request<AppConfig>('GET', '/v1/app/config', { anonymous: true, silent: true });
  },
  /**
   * Self-service business creation for a signed-in user without one (bearer, no organization context).
   * The caller becomes the owner of a 14-day trial organization.
   * Errors: 400 VALIDATION_ERROR, 401, 403 (self-registration disabled), 409 CONFLICT (already owns one), 429 RATE_LIMITED.
   */
  createOrganization(body: CreateOrganizationInput) {
    return request<CreatedOrganization>('POST', '/v1/auth/organizations', { body, silent: true });
  },
};

/** Self-registration is open unless the config says otherwise (unknown → show it; the API still decides). */
export function registrationOpen(config: AppConfig | undefined) {
  return config?.registration_enabled !== false;
}
