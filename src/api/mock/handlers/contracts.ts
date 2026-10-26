/**
 * Contracts: platform presets (tenant read-only listing), tenant templates and contract instances with
 * the signing flow (WhatsApp OTP for customer signers, signatures, media, void/finalize).
 * Mirrors backend `internal/modules/contracts` (routes.go, usecase/service.go, usecase/otp.go).
 * State is attached to the demo DB object so it persists with it and is reset with it.
 * Demo OTP code: 123456.
 */
import type { ContractPreset, SignerSlot } from '@/features/contract-presets/services/contract-presets.service';
import type { ContractInstance, ContractMedia, ContractSigner, ContractTemplate } from '@/features/contracts/services/contracts.service';

import { bool, fail, type MockCtx, notFound, now, paginate, requireOwner, requirePerm, resourceMeta, route, search, sortBy, str, uuid, uuidQuery, validation } from '../core';
import { getDb, type MockDb } from '../db';
import { activeSmsProvider } from './sms';

const READ = 'tenant.contracts.read';
const WRITE = 'tenant.contracts.write';
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MEDIA_MAX_BYTES = 12 * 1024 * 1024;
export const DEMO_OTP_CODE = '123456';
const OTP_TTL_MS = 10 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_VERIFICATION_TTL_MS = 30 * 60_000;

type TemplateRow = ContractTemplate & { _org: string };
type SignerRow = ContractSigner & { _otp?: { code: string; expires: number; sentAt: number } };
type InstanceRow = Omit<ContractInstance, 'signers'> & { _org: string; signers: SignerRow[] };
type Store = { presets: ContractPreset[]; templates: TemplateRow[]; instances: InstanceRow[]; seededOrgs: string[] };

const VARS = [
  'customer_name',
  'customer_phone',
  'customer_email',
  'plate',
  'vehicle_label',
  'job_total',
  'job_currency',
  'job_notes',
  'org_name',
  'org_phone',
  'org_email',
  'org_address',
  'org_city',
  'org_district',
  'org_full_address',
  'org_website',
  'today',
];

const SLOTS: SignerSlot[] = [
  { role: 'customer', label: 'Müşteri', required: true },
  { role: 'staff', label: 'Personel', required: true },
];

const INTAKE_HTML = `<h2>Araç Kabul Sözleşmesi</h2>
<p><strong>{{org_name}}</strong> ({{org_full_address}}, tel: {{org_phone}}) ile <strong>{{customer_name}}</strong> (tel: {{customer_phone}}) arasında {{today}} tarihinde düzenlenmiştir.</p>
<h3>Araç bilgileri</h3>
<ul><li>Plaka: <strong>{{plate}}</strong></li><li>Araç: {{vehicle_label}}</li><li>Tahmini tutar: {{job_total}} {{job_currency}}</li></ul>
<h3>Şartlar</h3>
<ol><li>Araç teslim alındığı andaki hasar durumu fotoğraflarla kayıt altına alınır.</li><li>İşlem sırasında değerli eşyalar araçta bırakılmamalıdır.</li><li>Onaylanmayan ek işlemler için müşteriden izin alınır.</li></ol>
<p>Notlar: <em>{{job_notes}}</em></p>`;

const DELIVERY_HTML = `<h2>Teslim Tutanağı</h2>
<p>{{plate}} plakalı {{vehicle_label}} aracı, {{today}} tarihinde <strong>{{customer_name}}</strong> adına teslim edilmiştir.</p>
<p>Toplam tutar: <strong>{{job_total}} {{job_currency}}</strong></p>`;

function store(): Store {
  const db = getDb() as MockDb & { _contracts?: Store };
  if (!db._contracts) {
    const at = db.seededAt ?? now();
    db._contracts = {
      presets: [
        preset('Araç kabul sözleşmesi', 'Aracın teslim alınırken hasar ve şart onayı.', 'intake', INTAKE_HTML, SLOTS, true, at),
        preset('Teslim tutanağı', 'Aracın müşteriye teslimi.', 'delivery', DELIVERY_HTML, [SLOTS[0]], false, at),
      ],
      templates: [],
      instances: [],
      seededOrgs: [],
    };
  }
  return db._contracts;
}

function preset(title: string, description: string, category: string, html: string, slots: SignerSlot[], otp: boolean, at: string): ContractPreset {
  return {
    uuid: uuid(),
    title,
    description,
    category,
    content_json: {},
    content_html: html,
    variables: VARS.filter((v) => html.includes(`{{${v}}}`)),
    signer_slots: slots,
    signature_required: true,
    otp_required: otp,
    is_active: true,
    created_at: at,
    updated_at: at,
  };
}

/** Lazily seed two templates and three contracts (executed / pending / voided) per organization. */
export function orgStore(ctx: MockCtx) {
  const s = store();
  const org = ctx.orgUuid!;
  if (!s.seededOrgs.includes(org)) {
    s.seededOrgs.push(org);
    const templates = s.presets.map((p) => templateFromPreset(org, p, p.title));
    s.templates.push(...templates);
    const jobs = getDb()
      .jobs.filter((j) => j._org === org)
      .slice(0, 3);
    jobs.forEach((job, i) => {
      const inst = buildInstance(org, templates[0], job.uuid, 'Personel');
      if (i === 0) {
        inst.signers.forEach((sg) => signSigner(inst, sg, sg.suggested_name || sg.label));
        execute(inst);
      } else if (i === 2) {
        inst.status = 'voided';
        inst.voided_at = now();
      }
      s.instances.push(inst);
    });
  }
  return { s, org };
}

function templateFromPreset(org: string, p: ContractPreset, title: string): TemplateRow {
  const at = now();
  return {
    ...p,
    uuid: uuid(),
    preset_uuid: p.uuid,
    title,
    signer_slots: p.signer_slots.map((x) => ({ ...x })),
    variables: [...p.variables],
    created_at: at,
    updated_at: at,
    _org: org,
  };
}

function resolveVars(org: string, jobUuid: string) {
  const db = getDb();
  const job = db.jobs.find((j) => j.uuid === jobUuid && j._org === org);
  if (!job) return null;
  const o = db.organizations.find((x) => x.uuid === org);
  const customer = db.customers.find((c) => c.uuid === job.customer_uuid);
  const vars: Record<string, string> = {
    customer_name: job.customer_name,
    customer_phone: job.customer_phone,
    customer_email: customer?.email ?? '',
    plate: job.plate,
    vehicle_label: job.vehicle_label,
    job_total: job.total_amount,
    job_currency: job.currency,
    job_notes: job.notes,
    org_name: o?.name ?? '',
    org_phone: o?.phone ?? '',
    org_email: o?.email ?? '',
    org_address: o?.address ?? '',
    org_city: o?.city ?? '',
    org_district: o?.district ?? '',
    org_full_address: [o?.address, o?.district, o?.city].filter(Boolean).join(', '),
    org_website: '',
    today: new Date().toLocaleDateString('tr-TR'),
  };
  return { job, vars };
}

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildInstance(org: string, tpl: TemplateRow, jobUuid: string, actorName: string, title?: string): InstanceRow {
  const resolved = resolveVars(org, jobUuid);
  if (!resolved) return notFound('Service job') as never;
  const { job, vars } = resolved;
  const s = store();
  const number = s.instances.filter((i) => i._org === org).reduce((m, i) => Math.max(m, i.number), 0) + 1;
  const at = now();
  const html = tpl.content_html.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? escapeHtml(vars[k]) : m));
  return {
    uuid: uuid(),
    number,
    number_label: `SZL-${String(number).padStart(5, '0')}`,
    locale: 'tr',
    template_uuid: tpl.uuid,
    title: title?.trim() || tpl.title,
    subject_type: 'service_job',
    subject_uuid: jobUuid,
    content_json: tpl.content_json,
    content_html: html,
    variables_resolved: vars,
    signature_required: tpl.signature_required,
    otp_required: tpl.otp_required,
    status: 'pending',
    content_sha256: null,
    pdf_object_key: null,
    pdf_url: null,
    pdf_error: '',
    executed_at: null,
    voided_at: null,
    created_at: at,
    updated_at: at,
    signers: tpl.signer_slots
      .filter((slot) => slot.role.trim() && slot.label.trim())
      .map((slot, i) => ({
        uuid: uuid(),
        role: slot.role,
        label: slot.label,
        required: slot.required,
        sort_order: i,
        status: 'pending',
        suggested_name: slot.role === 'customer' ? job.customer_name : slot.role === 'staff' ? job.assignee_name || actorName : '',
        phone: slot.role === 'customer' ? job.customer_phone : '',
        otp_required: tpl.otp_required && slot.role === 'customer',
        otp_verified: false,
        created_at: at,
        updated_at: at,
      })),
    signatures: [],
    media: [],
    _org: org,
  };
}

function signSigner(inst: InstanceRow, signer: SignerRow, displayName: string) {
  const at = now();
  signer.status = 'signed';
  signer.updated_at = at;
  inst.signatures = [
    ...(inst.signatures ?? []),
    {
      uuid: uuid(),
      signer_uuid: signer.uuid,
      display_name: displayName,
      object_key: `contracts/${inst.uuid}/${signer.uuid}.png`,
      url: null,
      content_sha256: '',
      signed_by_user_id: 1,
      ip_address: '127.0.0.1',
      user_agent: 'otopoly-mobile',
      signed_at: at,
    },
  ];
  inst.updated_at = at;
}

function execute(inst: InstanceRow) {
  const at = now();
  inst.status = 'executed';
  inst.executed_at = at;
  inst.pdf_object_key = `contracts/${inst.uuid}.pdf`;
  inst.pdf_url = `/v1/tenant/contracts/instances/${inst.uuid}/pdf`;
  inst.content_sha256 = inst.uuid.replace(/-/g, '').padEnd(64, '0');
  inst.updated_at = at;
}

const maskPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.length < 4 ? '***' : `${d.slice(0, 3)}*****${d.slice(-2)}`;
};

function toInstance(row: InstanceRow): ContractInstance {
  const { _org, signers, ...rest } = row;
  const nowMs = Date.now();
  return {
    ...rest,
    signers: signers.map(({ _otp, ...s }) => ({
      ...s,
      // "verified" = verification still fresh (backend signerOTPFresh, 30 min).
      otp_verified: Boolean(s.otp_verified_at && nowMs - Date.parse(s.otp_verified_at) <= OTP_VERIFICATION_TTL_MS),
    })),
  };
}

const toTemplate = ({ _org, ...rest }: TemplateRow): ContractTemplate => rest;

function findTemplate(ctx: MockCtx, id = ctx.params.uuid) {
  const { s, org } = orgStore(ctx);
  return s.templates.find((x) => x.uuid === id && x._org === org) ?? (notFound('Contract template') as never);
}

function findInstance(ctx: MockCtx) {
  const { s, org } = orgStore(ctx);
  return s.instances.find((x) => x.uuid === ctx.params.uuid && x._org === org) ?? (notFound('Contract instance') as never);
}

function findSigner(inst: InstanceRow, id: string) {
  return inst.signers.find((x) => x.uuid === id) ?? (notFound('Signer') as never);
}

function requireOpen(inst: InstanceRow, message = 'contract is not open for signing') {
  if (inst.status !== 'pending' && inst.status !== 'draft') fail(409, 'CONFLICT', message);
}

function templateBody(ctx: MockCtx, partial: boolean) {
  const b = ctx.body;
  const out: Partial<ContractTemplate> = {};
  if (!partial || b.title !== undefined) {
    const title = str(b.title).trim();
    if (!title) validation([{ field: 'title', message: 'title is required', code: 'required' }]);
    out.title = title;
  }
  if (b.description !== undefined || !partial) out.description = str(b.description);
  if (b.category !== undefined || !partial) out.category = str(b.category).trim() || 'general';
  if (b.content_html !== undefined || !partial) out.content_html = str(b.content_html, '<p></p>');
  if (b.content_json !== undefined || !partial) out.content_json = b.content_json ?? {};
  if (Array.isArray(b.variables)) out.variables = (b.variables as unknown[]).map(String);
  else if (!partial) out.variables = [...VARS];
  if (Array.isArray(b.signer_slots)) {
    out.signer_slots = (b.signer_slots as SignerSlot[])
      .map((x) => ({ role: str(x.role).trim(), label: str(x.label).trim(), required: bool(x.required, true) }))
      .filter((x) => x.role && x.label);
  } else if (!partial) out.signer_slots = SLOTS.map((x) => ({ ...x }));
  for (const k of ['signature_required', 'otp_required', 'is_active'] as const) {
    if (b[k] !== undefined || !partial) out[k] = bool(b[k], k !== 'otp_required');
  }
  return out;
}

// ─── Templates ────────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/contracts/templates/meta', (ctx) => {
  requirePerm(ctx, READ);
  return resourceMeta('tenant.contracts', '-created_at', { read: true, create: true, update: true, delete: true, search: true, filter: true, sort: true }, { searchable: ['title'], sortable: ['title', 'created_at'], filterable: ['is_active'] });
});

route('GET', '/v1/tenant/contracts/presets', (ctx) => {
  requirePerm(ctx, READ);
  const items = search(
    store().presets.filter((p) => p.is_active),
    ctx.query.q,
    ['title', 'description'],
  );
  return paginate(sortBy(items, ctx.query.sort, 'title'), ctx.query);
});

route('GET', '/v1/tenant/contracts/templates', (ctx) => {
  requirePerm(ctx, READ);
  const { s, org } = orgStore(ctx);
  let items = s.templates.filter((x) => x._org === org);
  if (ctx.query.is_active) items = items.filter((x) => String(x.is_active) === ctx.query.is_active);
  items = search(items, ctx.query.q, ['title', 'description', 'category']);
  return paginate(sortBy(items, ctx.query.sort, 'title').map(toTemplate), ctx.query);
});

route('POST', '/v1/tenant/contracts/templates', (ctx) => {
  requireOwner(ctx, WRITE);
  const { s, org } = orgStore(ctx);
  const at = now();
  const row = { ...(templateBody(ctx, false) as ContractTemplate), uuid: uuid(), preset_uuid: str(ctx.body.preset_uuid) || null, created_at: at, updated_at: at, _org: org };
  s.templates.push(row);
  return toTemplate(row);
});

route('POST', '/v1/tenant/contracts/templates/clone', (ctx) => {
  requireOwner(ctx, WRITE);
  const presetUuid = str(ctx.body.preset_uuid).trim();
  if (!presetUuid) validation([{ field: 'preset_uuid', message: 'preset_uuid is required', code: 'required' }]);
  const { s, org } = orgStore(ctx);
  const p = s.presets.find((x) => x.uuid === presetUuid && x.is_active) ?? (notFound('Contract preset') as never);
  const row = templateFromPreset(org, p, str(ctx.body.title).trim() || p.title);
  s.templates.push(row);
  return toTemplate(row);
});

route('GET', '/v1/tenant/contracts/templates/:uuid', (ctx) => {
  requirePerm(ctx, READ);
  return toTemplate(findTemplate(ctx));
});

route('PATCH', '/v1/tenant/contracts/templates/:uuid', (ctx) => {
  requireOwner(ctx, WRITE);
  const row = findTemplate(ctx);
  Object.assign(row, templateBody(ctx, true), { updated_at: now() });
  return toTemplate(row);
});

route('DELETE', '/v1/tenant/contracts/templates/:uuid', (ctx) => {
  requireOwner(ctx, WRITE);
  const row = findTemplate(ctx);
  const s = store();
  s.templates = s.templates.filter((x) => x !== row);
  return { deleted: true };
});

// ─── Instances ────────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/contracts/instances', (ctx) => {
  requirePerm(ctx, READ);
  const { s, org } = orgStore(ctx);
  let items = s.instances.filter((x) => x._org === org);
  if (ctx.query.status) items = items.filter((x) => x.status === ctx.query.status);
  if (ctx.query.subject_type) items = items.filter((x) => x.subject_type === ctx.query.subject_type);
  if (ctx.query.subject_uuid) items = items.filter((x) => x.subject_uuid === ctx.query.subject_uuid);
  // Contracts are bound to service jobs: the job's customer decides.
  const customerUuid = uuidQuery(ctx, 'customer_uuid');
  if (customerUuid) {
    const jobs = new Set(getDb().jobs.filter((j) => j._org === org && j.customer_uuid === customerUuid).map((j) => j.uuid));
    items = items.filter((x) => x.subject_type === 'service_job' && jobs.has(x.subject_uuid));
  }
  items = search(items, ctx.query.q, ['title', 'number_label', (x) => x.variables_resolved.customer_name ?? '', (x) => x.variables_resolved.plate ?? '']);
  return paginate(sortBy(items, ctx.query.sort, '-created_at').map(toInstance), ctx.query);
});

route('POST', '/v1/tenant/contracts/instances', (ctx) => {
  requirePerm(ctx, WRITE);
  const templateUuid = str(ctx.body.template_uuid).trim();
  const subjectUuid = str(ctx.body.subject_uuid).trim();
  const subjectType = str(ctx.body.subject_type).trim() || 'service_job';
  if (!templateUuid || !subjectUuid) validation([{ field: templateUuid ? 'subject_uuid' : 'template_uuid', message: 'template_uuid and subject_uuid are required', code: 'required' }]);
  if (subjectType !== 'service_job') validation([{ field: 'subject_type', message: 'unsupported subject_type' }]);
  const { s, org } = orgStore(ctx);
  const tpl = findTemplate(ctx, templateUuid);
  if (!tpl.is_active) validation([{ field: 'template_uuid', message: 'template is inactive' }]);
  const actor = ctx.user ? `${ctx.user.name} ${ctx.user.surname}`.trim() : '';
  const inst = buildInstance(org, tpl, subjectUuid, actor, str(ctx.body.title));
  // No signatures required and not deferred → executed right away (backend CreateInstance).
  if (!inst.signature_required && !bool(ctx.body.defer_execute)) execute(inst);
  s.instances.push(inst);
  return toInstance(inst);
});

route('GET', '/v1/tenant/contracts/instances/:uuid', (ctx) => {
  requirePerm(ctx, READ);
  return toInstance(findInstance(ctx));
});

route('POST', '/v1/tenant/contracts/instances/:uuid/void', (ctx) => {
  requireOwner(ctx, WRITE);
  const inst = findInstance(ctx);
  if (inst.status !== 'draft' && inst.status !== 'pending') fail(409, 'CONFLICT', 'only draft or pending contracts can be voided');
  inst.status = 'voided';
  inst.voided_at = now();
  inst.updated_at = inst.voided_at;
  return toInstance(inst);
});

route('POST', '/v1/tenant/contracts/instances/:uuid/finalize', (ctx) => {
  requirePerm(ctx, WRITE);
  const inst = findInstance(ctx);
  requireOpen(inst, 'contract is not open');
  if (inst.signature_required) fail(409, 'CONFLICT', 'contract requires signatures');
  execute(inst);
  return toInstance(inst);
});

route('POST', '/v1/tenant/contracts/instances/:uuid/signers/:signerUuid/otp', (ctx) => {
  requirePerm(ctx, WRITE);
  const inst = findInstance(ctx);
  requireOpen(inst);
  const signer = findSigner(inst, ctx.params.signerUuid);
  if (signer.status === 'signed') fail(409, 'CONFLICT', 'signer already signed');
  if (!signer.otp_required) fail(409, 'CONFLICT', 'signer does not require OTP');
  const phone = str(ctx.body.phone).trim() || signer.phone;
  if (phone.replace(/\D/g, '').length < 10) validation([{ field: 'phone', message: 'a valid phone number is required' }]);
  const t = Date.now();
  if (signer._otp && t - signer._otp.sentAt < OTP_RESEND_MS) {
    fail(429, 'RATE_LIMITED', `retry after ${Math.ceil((signer._otp.sentAt + OTP_RESEND_MS - t) / 1000)}s`);
  }
  const channel = str(ctx.body.channel).trim() || 'whatsapp';
  if (channel !== 'whatsapp' && channel !== 'sms') validation([{ field: 'channel', message: 'channel must be whatsapp or sms' }]);
  if (channel === 'sms' && !activeSmsProvider(ctx)) fail(409, 'OTP_CHANNEL_UNAVAILABLE', 'no active SMS provider');
  signer._otp = { code: DEMO_OTP_CODE, expires: t + OTP_TTL_MS, sentAt: t };
  signer.phone = phone;
  signer.otp_channel = channel as 'whatsapp' | 'sms';
  signer.otp_phone_masked = maskPhone(phone);
  return {
    channel,
    phone_masked: signer.otp_phone_masked,
    expires_at: new Date(t + OTP_TTL_MS).toISOString(),
    resend_at: new Date(t + OTP_RESEND_MS).toISOString(),
  };
});

route('POST', '/v1/tenant/contracts/instances/:uuid/signers/:signerUuid/otp/verify', (ctx) => {
  requirePerm(ctx, WRITE);
  const inst = findInstance(ctx);
  requireOpen(inst);
  const signer = findSigner(inst, ctx.params.signerUuid);
  const code = str(ctx.body.code).trim();
  if (!signer._otp || signer._otp.expires < Date.now() || code !== signer._otp.code) fail(400, 'INVALID_OTP_CODE', 'invalid or expired code');
  signer._otp = undefined;
  signer.otp_verified_at = now();
  signer.updated_at = signer.otp_verified_at;
  return toInstance(inst);
});

route('POST', '/v1/tenant/contracts/instances/:uuid/signers/:signerUuid/sign', (ctx) => {
  requirePerm(ctx, WRITE);
  const displayName = str(ctx.body.display_name).trim();
  if (!displayName) validation([{ field: 'display_name', message: 'display_name is required', code: 'required' }]);
  const png = str(ctx.body.signature_png_base64).replace(/^data:[^,]*,/, '');
  if (!png) validation([{ field: 'signature_png_base64', message: 'signature_png_base64 is required', code: 'required' }]);
  const inst = findInstance(ctx);
  requireOpen(inst);
  const signer = findSigner(inst, ctx.params.signerUuid);
  if (signer.status === 'signed') fail(409, 'CONFLICT', 'signer already signed');
  const fresh = signer.otp_verified_at && Date.now() - Date.parse(signer.otp_verified_at) <= OTP_VERIFICATION_TTL_MS;
  if (inst.otp_required && signer.role === 'customer' && !fresh) fail(409, 'OTP_REQUIRED', 'verify the WhatsApp code before signing');
  signSigner(inst, signer, displayName);
  if (inst.signers.every((x) => !x.required || x.status === 'signed')) execute(inst);
  return toInstance(inst);
});

route('POST', '/v1/tenant/contracts/instances/:uuid/media', (ctx) => {
  requirePerm(ctx, WRITE);
  const inst = findInstance(ctx);
  if (inst.status === 'executed' || inst.status === 'voided') fail(409, 'CONFLICT', 'contract is locked');
  const file = (ctx.body.file ?? {}) as { name?: string; type?: string; uri?: string; size?: number };
  if (!file.uri) fail(400, 'VALIDATION_ERROR', 'file is required');
  // Backend sniffs the bytes and only accepts raster images and PDF (12 MB body cap).
  if (!MEDIA_TYPES.includes(str(file.type).toLowerCase())) fail(400, 'VALIDATION_ERROR', 'file must be a JPEG, PNG, WebP, GIF image or a PDF');
  if ((file.size ?? 0) > MEDIA_MAX_BYTES) fail(400, 'VALIDATION_ERROR', 'invalid multipart form');
  const media: ContractMedia = {
    uuid: uuid(),
    object_key: `contracts/${inst.uuid}/media/${file.name ?? 'file'}`,
    url: file.uri ?? null,
    content_type: str(file.type).toLowerCase(),
    file_name: file.name ?? 'file',
    byte_size: file.size ?? 0,
    caption: str(ctx.body.caption),
    sort_order: inst.media?.length ?? 0,
    created_at: now(),
  };
  inst.media = [...(inst.media ?? []), media];
  return media;
});

route('DELETE', '/v1/tenant/contracts/instances/:uuid/media/:mediaUuid', (ctx) => {
  requirePerm(ctx, WRITE);
  const inst = findInstance(ctx);
  if (inst.status === 'executed' || inst.status === 'voided') fail(409, 'CONFLICT', 'contract is locked');
  if (!inst.media?.some((m) => m.uuid === ctx.params.mediaUuid)) notFound('Media');
  inst.media = inst.media!.filter((m) => m.uuid !== ctx.params.mediaUuid);
  return { deleted: true };
});
