import { request } from '@/api/client';

/** `POST /v1/push-devices` body (backend `PushDeviceInput`). */
export type PushDeviceInput = {
  token: string;
  platform: 'ios' | 'android';
  locale?: string;
  app_version?: string;
  device_name?: string;
};

export type PushDevice = {
  uuid: string;
  token: string;
  platform: 'ios' | 'android';
  locale: 'tr' | 'en' | '';
  app_version: string;
  device_name: string;
  last_seen_at: string;
  created_at: string;
};

export type PushDeviceRegistration = { device: PushDevice; push_enabled: boolean };

/** Expo push device registry. Devices belong to the user (no organization context needed). */
export const pushDevicesService = {
  register(body: PushDeviceInput) {
    return request<PushDeviceRegistration>('POST', '/v1/push-devices', { body, silent: true });
  },
  unregister(token: string) {
    return request<{ status: string }>('DELETE', `/v1/push-devices/${encodeURIComponent(token)}`, { silent: true });
  },
};
