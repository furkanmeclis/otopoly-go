import { request } from '@/api/client';
import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type AppConfig = Schemas['AppConfig'];
export type CreateOrganizationInput = Schemas['CreateOwnedOrganizationRequest'];
export type CreatedOrganization = Schemas['OwnedOrganizationCreated'];

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
export function registrationOpen(config: Pick<AppConfig, 'registration_enabled'> | undefined) {
  return config?.registration_enabled !== false;
}
