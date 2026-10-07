import { request } from '@/api/client';
import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type PushDeviceInput = Schemas['PushDeviceInput'];
export type PushDevice = Schemas['PushDevice'];
export type PushDeviceRegistration = Schemas['PushDeviceRegistration'];

/** Expo push device registry. Devices belong to the user (no organization context needed). */
export const pushDevicesService = {
  register(body: PushDeviceInput) {
    return request<PushDeviceRegistration>('POST', '/v1/push-devices', { body, silent: true });
  },
  unregister(token: string) {
    return request<{ status: string }>('DELETE', `/v1/push-devices/${encodeURIComponent(token)}`, { silent: true });
  },
};
