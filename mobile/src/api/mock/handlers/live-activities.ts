/**
 * Live Activity / widget push registration (`/v1/tenant/live-activities/*`, otopoly-go modules/livepush).
 *
 * The mock never sends pushes; it only keeps the registrations so the app's register / rotate /
 * unregister flow can be exercised (scripts/smoke/live-push.smoke.ts). Same rules as the backend:
 * tenant.jobs.read, another organization's job is 404, Android needs the caller's own push device.
 */
import type { LiveActivity, LiveActivityDevice } from '@/features/widgets/services/live-activities.service';

import { fail, type MockCtx, notFound, requirePerm, route, str, uuid, validation } from '../core';
import { getDb, type MockDb } from '../db';
import { pushDevicesOf } from './notifications';

type MockActivity = LiveActivity & { _org: string; _user: string; _device: string };
type MockLinkedDevice = { _org: string; _user: string; token: string; pushToStart: string; widgets: boolean };

type LiveExt = { _liveActivities?: MockActivity[]; _liveDevices?: MockLinkedDevice[] };
const ext = () => getDb() as MockDb & LiveExt;

const EXPO_RE = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;
const HEX_RE = /^[0-9a-fA-F]{16,400}$/;
const ACTIVITY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const LIFETIME_MS = 12 * 3600 * 1000;

function caller(ctx: MockCtx) {
  if (!ctx.user || !ctx.orgUuid) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  requirePerm(ctx, 'tenant.jobs.read');
  return { user: ctx.user!.uuid, org: ctx.orgUuid! };
}

function jobOf(ctx: MockCtx, org: string) {
  const job = getDb().jobs.find((j) => j.uuid === ctx.params.uuid && j._org === org);
  if (!job) notFound('Job');
  return job!;
}

const ownsDevice = (user: string, token: string) => pushDevicesOf(user).some((d) => d.token === token);

route('PUT', '/v1/tenant/live-activities/device', (ctx) => {
  const { user, org } = caller(ctx);
  const token = str(ctx.body.device_token).trim();
  const pushToStart = str(ctx.body.push_to_start_token).trim().toLowerCase();
  const errors: { field: string; message: string; code: string }[] = [];
  if (!EXPO_RE.test(token)) errors.push({ field: 'device_token', message: 'device_token is invalid', code: 'invalid' });
  if (pushToStart && !HEX_RE.test(pushToStart)) errors.push({ field: 'push_to_start_token', message: 'push_to_start_token is invalid', code: 'invalid' });
  if (errors.length) validation(errors);
  if (!ownsDevice(user, token)) notFound('Push device');
  const db = ext();
  db._liveDevices = (db._liveDevices ?? []).filter((d) => d.token !== token);
  const widgets = ctx.body.widgets !== false;
  db._liveDevices.push({ _org: org, _user: user, token, pushToStart, widgets });
  const out: LiveActivityDevice = { widgets_enabled: widgets, push_to_start: Boolean(pushToStart), live_activity_push: true };
  return out;
});

route('DELETE', '/v1/tenant/live-activities/device/:token', (ctx) => {
  const { user, org } = caller(ctx);
  const db = ext();
  db._liveDevices = (db._liveDevices ?? []).filter((d) => !(d.token === ctx.params.token && d._user === user && d._org === org));
  return { status: 'ok' };
});

route('PUT', '/v1/tenant/live-activities/jobs/:uuid', (ctx) => {
  const { user, org } = caller(ctx);
  const job = jobOf(ctx, org);
  const b = ctx.body;
  const platform = str(b.platform);
  const activityId = str(b.activity_id).trim();
  const device = str(b.device_token).trim();
  const errors: { field: string; message: string; code: string }[] = [];
  if (!ACTIVITY_RE.test(activityId)) errors.push({ field: 'activity_id', message: 'activity_id is invalid', code: 'invalid' });
  if (device && !EXPO_RE.test(device)) errors.push({ field: 'device_token', message: 'device_token is invalid', code: 'invalid' });
  if (platform === 'ios' && !HEX_RE.test(str(b.push_token).trim())) errors.push({ field: 'push_token', message: 'push_token is invalid', code: 'invalid' });
  if (platform === 'android' && !device) errors.push({ field: 'device_token', message: 'device_token is required', code: 'required' });
  if (platform !== 'ios' && platform !== 'android') errors.push({ field: 'platform', message: 'platform is invalid', code: 'invalid' });
  if (errors.length) validation(errors);
  if (platform === 'android' && !ownsDevice(user, device)) notFound('Push device');

  const db = ext();
  db._liveActivities ??= [];
  const expires = new Date(Date.now() + LIFETIME_MS).toISOString();
  let row = db._liveActivities.find((a) => a._user === user && a.platform === platform && a.activity_id === activityId && a._device === device);
  if (row && row._org !== org) notFound('Job');
  if (row) Object.assign(row, { job_uuid: job.uuid, expires_at: expires });
  else {
    row = { _org: org, _user: user, _device: device, uuid: uuid(), job_uuid: job.uuid, platform: platform as LiveActivity['platform'], activity_id: activityId, expires_at: expires, remote_updates: true };
    db._liveActivities.push(row);
  }
  const { _org, _user, _device, ...out } = row;
  return out;
});

route('POST', '/v1/tenant/live-activities/jobs/:uuid/unregister', (ctx) => {
  const { user, org } = caller(ctx);
  const job = jobOf(ctx, org);
  const activityId = str(ctx.body.activity_id).trim();
  const device = str(ctx.body.device_token).trim();
  const db = ext();
  db._liveActivities = (db._liveActivities ?? []).filter(
    (a) => !(a._user === user && a._org === org && a.job_uuid === job.uuid && (!activityId || a.activity_id === activityId) && (!device || a._device === device)),
  );
  return { status: 'ok' };
});

/** Test helpers: what the backend would push to. */
export function liveActivitiesOf(userUuid: string) {
  return (ext()._liveActivities ?? []).filter((a) => a._user === userUuid).map(({ _org, _user, _device, ...a }) => ({ ...a, org: _org, device: _device }));
}
export function linkedDevicesOf(userUuid: string) {
  return (ext()._liveDevices ?? []).filter((d) => d._user === userUuid);
}
