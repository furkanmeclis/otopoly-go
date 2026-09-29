import { fail, notFound, now, requireFields, requireOwner, requirePerm, route, str, uuid } from '../core';
import { getDb } from '../db';

function staffView(userUuid: string, orgUuid: string) {
  const db = getDb();
  const u = db.users.find((x) => x.uuid === userUuid)!;
  const m = db.memberships.find((x) => x.userUuid === userUuid && x.orgUuid === orgUuid)!;
  return { uuid: u.uuid, email: u.email, name: u.name, surname: u.surname, status: u.status, role: m.role, created_at: u.created_at };
}

route('GET', '/v1/tenant/staff/meta', (ctx) => {
  requirePerm(ctx, 'tenant.staff.read');
  return { resource: 'staff', capabilities: { read: true, create: ctx.permissions.has('tenant.staff.write') } };
});

route('GET', '/v1/tenant/staff', (ctx) => {
  requirePerm(ctx, 'tenant.staff.read');
  const items = getDb()
    .memberships.filter((m) => m.orgUuid === ctx.orgUuid)
    .map((m) => staffView(m.userUuid, ctx.orgUuid!))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, 'tr') : a.role === 'owner' ? -1 : 1));
  return { items, total: items.length, limit: items.length, offset: 0 };
});

route('POST', '/v1/tenant/staff', (ctx) => {
  requireOwner(ctx, 'tenant.staff.write');
  requireFields(ctx.body, ['name', 'surname', 'email', 'password']);
  const db = getDb();
  const email = str(ctx.body.email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'VALIDATION_ERROR', 'Invalid email', [{ field: 'email', message: 'invalid' }]);
  if (db.users.some((u) => u.email.toLowerCase() === email)) fail(409, 'CONFLICT', 'Email already in use', [{ field: 'email', message: 'taken' }]);
  if (str(ctx.body.password).length < 8) fail(400, 'VALIDATION_ERROR', 'Password too short', [{ field: 'password', message: 'min 8 characters' }]);
  const user = {
    uuid: uuid(),
    email,
    password: str(ctx.body.password),
    name: str(ctx.body.name).trim(),
    surname: str(ctx.body.surname).trim(),
    locale: 'tr',
    status: 'active' as const,
    roles: ['organization_user'],
    totpEnabled: false,
    created_at: now(),
  };
  db.users.push(user);
  db.memberships.push({ userUuid: user.uuid, orgUuid: ctx.orgUuid!, role: 'staff' });
  return staffView(user.uuid, ctx.orgUuid!);
});

route('PATCH', '/v1/tenant/staff/:uuid', (ctx) => {
  requireOwner(ctx, 'tenant.staff.write');
  const db = getDb();
  const m = db.memberships.find((x) => x.userUuid === ctx.params.uuid && x.orgUuid === ctx.orgUuid);
  if (!m) notFound('Staff member');
  if (m!.role === 'owner') fail(409, 'CONFLICT', 'The owner cannot be deactivated');
  const status = str(ctx.body.status);
  if (status !== 'active' && status !== 'inactive') fail(400, 'VALIDATION_ERROR', 'Invalid status', [{ field: 'status', message: 'invalid' }]);
  const u = db.users.find((x) => x.uuid === ctx.params.uuid)!;
  u.status = status as 'active' | 'inactive';
  if (status === 'inactive') db.sessions = db.sessions.filter((s) => s.userUuid !== u.uuid);
  return staffView(u.uuid, ctx.orgUuid!);
});

route('POST', '/v1/tenant/staff/:uuid/reset-password', (ctx) => {
  requireOwner(ctx, 'tenant.staff.write');
  const db = getDb();
  const m = db.memberships.find((x) => x.userUuid === ctx.params.uuid && x.orgUuid === ctx.orgUuid);
  if (!m) notFound('Staff member');
  if (m!.role === 'owner') fail(409, 'CONFLICT', 'Use profile settings to change the owner password');
  if (str(ctx.body.password).length < 8) fail(400, 'VALIDATION_ERROR', 'Password too short', [{ field: 'password', message: 'min 8 characters' }]);
  db.users.find((x) => x.uuid === ctx.params.uuid)!.password = str(ctx.body.password);
  return { ok: true };
});
