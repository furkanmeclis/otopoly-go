import { request } from '@/api/client';
import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type LiveActivityInput = Schemas['LiveActivityInput'];
export type LiveActivity = Schemas['LiveActivity'];
export type LiveActivityDeviceInput = Schemas['LiveActivityDeviceInput'];
export type LiveActivityDevice = Schemas['LiveActivityDevice'];
export type WidgetSnapshotDto = Schemas['WidgetSnapshot'];

/**
 * Server-side registry of running job Live Activities / Live Updates and of the organization whose
 * widgets this device shows (otopoly-go modules/livepush). Organization comes from the token (`oid`).
 * Every call is silent: these are background bookkeeping, never worth a toast.
 */
export const liveActivitiesService = {
  /** The caller's permission-filtered widget snapshot (same data as a `widgets.refresh` push). */
  widgetSnapshot() {
    return request<WidgetSnapshotDto>('GET', '/v1/tenant/live-activities/widget-snapshot', { silent: true });
  },
  registerDevice(body: LiveActivityDeviceInput) {
    return request<LiveActivityDevice>('PUT', '/v1/tenant/live-activities/device', { body, silent: true });
  },
  unregisterDevice(token: string) {
    return request<{ status: string }>('DELETE', `/v1/tenant/live-activities/device/${encodeURIComponent(token)}`, { silent: true });
  },
  registerActivity(jobUuid: string, body: LiveActivityInput) {
    return request<LiveActivity>('PUT', `/v1/tenant/live-activities/jobs/${encodeURIComponent(jobUuid)}`, { body, silent: true });
  },
  unregisterActivity(jobUuid: string, body: { activity_id?: string; device_token?: string }) {
    return request<{ status: string }>('POST', `/v1/tenant/live-activities/jobs/${encodeURIComponent(jobUuid)}/unregister`, { body, silent: true });
  },
};
