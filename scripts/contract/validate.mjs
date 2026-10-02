/**
 * Validates recorded API exchanges against the OpenAPI 3.1 spec (JSON Schema 2020-12 via Ajv).
 *
 * Per exchange:
 *  - the endpoint exists in the spec (else "missing-in-spec", unless allowlisted with a reason),
 *  - query params are declared and match their schema (undeclared → warning),
 *  - the request body matches the JSON (or multipart) request schema,
 *  - the status code is documented (cross-cutting middleware errors are accepted everywhere),
 *  - the success envelope `{success:true,data,meta.request_id}` / the `Error` envelope is respected,
 *  - the response matches the documented response schema when the spec has one,
 *  - error codes exist in the backend (backend-error-codes.json) and LIMIT_REACHED details have the documented shape.
 */
import fs from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Error codes produced by middleware on any route (not repeated per operation in the spec). */
const CROSS_CUTTING = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NO_TENANT_MEMBERSHIP',
  'ORGANIZATION_CONTEXT_REQUIRED',
  'ORGANIZATION_ACCESS_EXPIRED',
  'SUBSCRIPTION_READ_ONLY',
  'FEATURE_DISABLED',
  'RATE_LIMITED',
  'STEP_UP_REQUIRED',
  'INTERNAL_ERROR',
]);

const LIMIT_FIELDS = ['feature', 'limit', 'used', 'tolerance', 'owner_notified'];

/** Areas used by the report (docs/backend/CONTRACT_REPORT.md). */
export function areaOf(path) {
  const rules = [
    [/^\/v1\/auth\/qr\b/, 'qr'],
    [/^\/v1\/(auth|public\/organizations)\b/, 'auth'],
    [/^\/v1\/(notifications|notification-preferences|push-devices|tenant\/notification-preferences)\b/, 'notifications'],
    [/^\/v1\/tenant\/billing\b/, 'billing'],
    [/^\/v1\/tenant\/reports\b/, 'dashboard'],
    [/^\/v1\/tenant\/jobs\b/, 'jobs'],
    [/^\/v1\/tenant\/(customers|customer-vehicles|vehicle-catalog)\b/, 'customers'],
    [/^\/v1\/tenant\/(finance|cari)\b/, 'finance'],
    [/^\/v1\/tenant\/(sales|purchases|suppliers)\b/, 'commerce'],
    [/^\/v1\/(tenant\/(quotes|leads|todos)|public\/quotes)\b/, 'crm'],
    [/^\/v1\/tenant\/ai\b/, 'ai'],
    [/^\/v1\/tenant\/catalog\b/, 'catalog'],
    [/^\/v1\/tenant\/(contracts|imports|exports)\b/, 'documents'],
    [/^\/v1\/(tenant\/(settings|staff|messaging|daily-summary|vehicle-alerts)|platform\/contract-presets)\b/, 'settings'],
  ];
  for (const [re, area] of rules) if (re.test(path)) return area;
  return 'other';
}

const toTemplate = (p) => p.replace(/\/:([a-zA-Z_]+)/g, '/{$1}');
const shape = (p) => p.replace(/\{[^}]+\}/g, '{}');

function short(errors) {
  return (errors ?? [])
    .slice(0, 6)
    .map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}${e.params?.allowedValues ? ` ${JSON.stringify(e.params.allowedValues)}` : ''}`)
    .join('; ');
}

export function validateRecords({ specPath, allowlistPath, errorCodesPath, backendRoutesPath, records, routes, verbose }) {
  const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
  const allow = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const backendCodes = new Set(JSON.parse(fs.readFileSync(errorCodesPath, 'utf8')).codes);
  const backendRoutes = new Set(JSON.parse(fs.readFileSync(backendRoutesPath, 'utf8')).routes.map((r) => shape(r)));
  const missingAllowed = new Map(Object.entries(allow.missingInBackend ?? {}));
  const statusGaps = allow.undocumentedStatus ?? {};

  // Known spec bugs, fixed in memory before validating (each entry carries its reason; see allowlist.json).
  for (const fix of allow.specFixes ?? []) {
    const node = fix.path.split('.').reduce((a, k) => a?.[k], spec);
    if (!node || !(fix.rename.from in node)) throw new Error(`specFixes: ${fix.path} has no ${fix.rename.from} (spec changed? drop the fix)`);
    node[fix.rename.to] = node[fix.rename.from];
    delete node[fix.rename.from];
  }

  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  for (const f of ['int32', 'int64', 'binary', 'byte', 'double', 'float', 'password']) ajv.addFormat(f, true);
  ajv.addSchema(spec, 'openapi.json');
  const compiled = new Map();
  const validatorFor = (schema, pointer) => {
    if (compiled.has(pointer)) return compiled.get(pointer);
    // Inline schemas are compiled through a JSON pointer into the spec so internal $refs resolve.
    const fn = ajv.compile({ $ref: `openapi.json#${pointer}` });
    compiled.set(pointer, fn);
    return fn;
  };
  const esc = (s) => s.replace(/~/g, '~0').replace(/\//g, '~1');
  const deref = (obj) => {
    let o = obj;
    while (o?.$ref) o = o.$ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((a, k) => a?.[k], spec);
    return o;
  };

  // ── Spec index ──
  const ops = [];
  for (const [template, item] of Object.entries(spec.paths)) {
    const literal = template.split('/').filter((s) => s && !s.startsWith('{')).length;
    const regex = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const raw = [
        ...(item.parameters ?? []).map((x, i) => [x, `/paths/${esc(template)}/parameters/${i}`]),
        ...(op.parameters ?? []).map((x, i) => [x, `/paths/${esc(template)}/${m}/parameters/${i}`]),
      ];
      const params = raw.map(([x, ptr]) => ({ ...deref(x), schemaPointer: `${x.$ref ? x.$ref.slice(1) : ptr}/schema` }));
      ops.push({ method: m.toUpperCase(), template, regex, literal, op, params, pointer: `/paths/${esc(template)}/${m}` });
    }
  }
  const findOp = (method, path) => {
    const candidates = ops.filter((o) => o.regex.test(path)).sort((a, b) => b.literal - a.literal);
    return { op: candidates.find((o) => o.method === method), pathKnown: candidates.length > 0, template: candidates[0]?.template };
  };
  const byShape = new Map(ops.map((o) => [`${o.method} ${shape(o.template)}`, o]));

  const issues = [];
  const endpoints = new Map();
  const endpointKey = (method, template) => `${method} ${template}`;
  const touch = (method, template, extra = {}) => {
    const key = endpointKey(method, template);
    if (!endpoints.has(key))
      endpoints.set(key, { method, template, area: areaOf(template), inSpec: false, inMock: false, exercised: 0, statuses: new Set(), ok: true, responseSchema: false, requestSchema: false });
    return Object.assign(endpoints.get(key), extra);
  };

  // Mock routes (all endpoints the app can reach in demo mode).
  for (const r of routes) {
    const t = toTemplate(r.path);
    const specOp = byShape.get(`${r.method} ${shape(t)}`);
    touch(r.method, specOp?.template ?? t, { inMock: true });
  }

  let unrouted = 0;
  const add = (severity, kind, rec, template, message) => {
    issues.push({ severity, kind, endpoint: `${rec.method} ${template}`, suite: rec.suite, tag: rec.tag, status: rec.status, message });
    if (severity === 'error') touch(rec.method, template).ok = false;
  };

  for (const rec of records) {
    // Smoke suites probe routes the mock deliberately lacks (e.g. purchase-only billing routes); not app traffic.
    if (rec.status === 404 && /^No route for /.test(rec.payload?.error?.message ?? '')) {
      unrouted++;
      continue;
    }
    const { op: o, pathKnown, template: pathTemplate } = findOp(rec.method, rec.path);
    if (!o) {
      const routeMatch = routes.find((r) => r.method === rec.method && new RegExp(`^${r.path.replace(/:[a-zA-Z_]+/g, '[^/]+')}$`).test(rec.path));
      const template = routeMatch ? toTemplate(routeMatch.path) : (pathTemplate ?? rec.path);
      const ep = touch(rec.method, template);
      ep.exercised++;
      ep.statuses.add(rec.status);
      const key = endpointKey(rec.method, shape(template));
      if (backendRoutes.has(key)) {
        ep.specGap = 'route exists in the Go router, missing from openapi.yaml';
        add('warn', 'spec-gap', rec, template, ep.specGap);
        continue;
      }
      const reason = [...missingAllowed.entries()].find(([k]) => shape(k) === key)?.[1];
      if (reason) ep.allowlisted = reason;
      else add('error', pathKnown ? 'method-missing-in-backend' : 'missing-in-backend', rec, template, 'endpoint neither in openapi.yaml nor in the Go router (fix the app, or list it in allowlist.json missingInBackend)');
      continue;
    }
    const ep = touch(rec.method, o.template, { inSpec: true });
    ep.exercised++;
    ep.statuses.add(rec.status);
    // Rejected requests (negative cases, permission checks) are not validated as request bodies.
    const negative = rec.status >= 400;

    // Query parameters.
    for (const [name, raw] of Object.entries(rec.query ?? {})) {
      if (raw === undefined || raw === null || raw === '') continue;
      const p = o.params.find((x) => x.in === 'query' && x.name === name);
      if (!p) {
        add('warn', 'undeclared-query', rec, o.template, `query param "${name}" not declared`);
        continue;
      }
      const s = deref(p.schema) ?? {};
      const types = [].concat(s.type ?? []);
      let v = raw;
      if (typeof v === 'string' && (types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      if (typeof v === 'string' && types.includes('boolean') && (v === 'true' || v === 'false')) v = v === 'true';
      if (typeof v === 'number' && types.includes('string')) v = String(v);
      if (typeof v === 'boolean' && types.includes('string')) v = String(v);
      if (!p.schema) continue;
      const fn = validatorFor(p.schema, p.schemaPointer);
      if (!fn(v)) add('error', 'query', rec, o.template, `query "${name}"=${JSON.stringify(raw)}: ${short(fn.errors)}`);
    }

    // Request body.
    const reqBody = deref(o.op.requestBody);
    if (rec.multipart) {
      const mp = reqBody?.content?.['multipart/form-data'];
      if (!reqBody) add('warn', 'spec-gap', rec, o.template, 'multipart upload; spec documents no request body');
      else if (!mp) add('error', 'request-content-type', rec, o.template, 'app sends multipart/form-data, spec does not declare it');
      else {
        const s = deref(mp.schema) ?? {};
        const props = s.properties ?? {};
        const sent = Object.keys(rec.body ?? {});
        for (const r of s.required ?? []) if (!sent.includes(r)) add('error', 'request', rec, o.template, `multipart field "${r}" required by spec, not sent`);
        if (Object.keys(props).length) for (const k of sent) if (!(k in props)) add('error', 'request', rec, o.template, `multipart field "${k}" not in spec`);
        touch(rec.method, o.template).requestSchema = true;
      }
    } else if (rec.body !== null && rec.body !== undefined) {
      const json = reqBody?.content?.['application/json'];
      if (!reqBody) {
        if (typeof rec.body === 'object' && Object.keys(rec.body).length) add('warn', 'spec-gap', rec, o.template, `body sent (${Object.keys(rec.body).join(', ')}) but spec declares no request body`);
      } else if (!json) {
        add('error', 'request-content-type', rec, o.template, `app sends JSON, spec declares ${Object.keys(reqBody.content ?? {}).join(', ')}`);
      } else if (json.schema && !negative) {
        touch(rec.method, o.template).requestSchema = true;
        const pointer = o.op.requestBody.$ref ? `${o.op.requestBody.$ref.slice(1)}/content/application~1json/schema` : `${o.pointer}/requestBody/content/application~1json/schema`;
        const fn = validatorFor(json.schema, pointer);
        if (!fn(rec.body)) add('error', 'request', rec, o.template, `request body: ${short(fn.errors)}`);
      }
    } else if (reqBody?.required && reqBody.content?.['application/json'] && !negative && rec.status < 400) {
      const s = deref(reqBody.content['application/json'].schema);
      if (s?.required?.length) add('error', 'request', rec, o.template, `spec requires a body (${s.required.join(', ')}), none sent`);
    }

    // Response.
    const status = String(rec.status);
    const code = rec.payload?.error?.code;
    const documented = o.op.responses?.[status] ?? o.op.responses?.[`${status[0]}XX`] ?? o.op.responses?.default;
    const gap = statusGaps[`${rec.method} ${o.template} ${status}`];
    if (!documented && gap) add('warn', 'spec-gap', rec, o.template, `status ${status}${code ? ` ${code}` : ''} not in spec: ${gap}`);
    else if (!documented && !(rec.status >= 400 && CROSS_CUTTING.has(code)))
      add('error', 'undocumented-status', rec, o.template, `status ${status}${code ? ` ${code}` : ''} not documented (spec: ${Object.keys(o.op.responses ?? {}).join(', ')})`);
    const payload = rec.payload;
    if (rec.status < 400) {
      if (!payload || payload.success !== true || !('data' in payload) || typeof payload.meta?.request_id !== 'string')
        add('error', 'envelope', rec, o.template, 'success envelope {success:true,data,meta.request_id} violated');
      const res = deref(documented);
      const nonJson = Object.keys(res?.content ?? {}).filter((c) => c !== 'application/json');
      if (nonJson.length && !res.content['application/json'] && payload?.success === true)
        add('warn', 'live-transport', rec, o.template, `live API answers ${nonJson.join(', ')}; the mock/app use a JSON envelope — needs a ${nonJson.join(', ')} client before going live`);
      const schema = res?.content?.['application/json']?.schema;
      if (schema) {
        touch(rec.method, o.template).responseSchema = true;
        const respPtr = o.op.responses[status]?.$ref ? `${o.op.responses[status].$ref.slice(1)}` : `${o.pointer}/responses/${status}`;
        const fn = validatorFor(schema, `${respPtr}/content/application~1json/schema`);
        if (!fn(payload)) add('error', 'response', rec, o.template, `response ${status}: ${short(fn.errors)}`);
      }
    } else {
      const fn = validatorFor(spec.components.schemas.Error, '/components/schemas/Error');
      if (!fn(payload)) add('error', 'error-envelope', rec, o.template, `error envelope: ${short(fn.errors)}`);
      if (code && !backendCodes.has(code)) add('error', 'error-code', rec, o.template, `error code ${code} does not exist in the backend`);
      if (code === 'LIMIT_REACHED') {
        const d = payload.error.details ?? [];
        const fields = d.map((x) => x.field);
        const missing = LIMIT_FIELDS.filter((f) => !fields.includes(f));
        if (missing.length || d.some((x) => typeof x.message !== 'string')) add('error', 'error-details', rec, o.template, `LIMIT_REACHED details must be {field,message:string} for ${LIMIT_FIELDS.join(',')} (missing ${missing.join(',')})`);
      }
    }
  }

  // ── Report ──
  const eps = [...endpoints.values()];
  const appEps = eps.filter((e) => e.inMock || e.exercised);
  const missing = appEps.filter((e) => !e.inSpec && !byShape.has(`${e.method} ${shape(e.template)}`));
  for (const e of missing) if (!e.specGap && backendRoutes.has(`${e.method} ${shape(e.template)}`)) e.specGap = 'route exists in the Go router, missing from openapi.yaml';
  for (const e of appEps) if (byShape.has(`${e.method} ${shape(e.template)}`)) e.inSpec = true;
  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');

  const areas = {};
  for (const e of appEps) {
    const a = (areas[e.area] ??= { endpoints: 0, inSpec: 0, exercised: 0, responseSchema: 0, requestSchema: 0, failing: 0, missing: [] });
    a.endpoints++;
    if (e.inSpec) a.inSpec++;
    else a.missing.push(`${e.method} ${e.template}${e.specGap ? ' [spec gap]' : e.allowlisted ? ` (${e.allowlisted})` : ''}`);
    if (e.exercised) a.exercised++;
    if (e.responseSchema) a.responseSchema++;
    if (e.requestSchema) a.requestSchema++;
    if (!e.ok) a.failing++;
  }

  const unexercised = appEps.filter((e) => !e.exercised).map((e) => `${e.method} ${e.template}`);
  const dedup = new Map();
  for (const i of issues) {
    const k = `${i.severity}|${i.kind}|${i.endpoint}|${i.message}`;
    if (!dedup.has(k)) dedup.set(k, { ...i, count: 0 });
    dedup.get(k).count++;
  }

  const total = appEps.length;
  const exercised = appEps.filter((e) => e.exercised).length;
  console.log(`\nContract: ${records.length - unrouted} exchanges (${unrouted} deliberate unrouted probes skipped), ${total} app endpoints, ${exercised} exercised (${((exercised / total) * 100).toFixed(1)}%), ${appEps.filter((e) => e.inSpec).length} in spec, ${missing.length} missing in spec`);
  console.log('area          endpoints  in-spec  exercised  resp-schema  req-schema  failing');
  for (const [a, v] of Object.entries(areas).sort())
    console.log(`${a.padEnd(14)}${String(v.endpoints).padStart(9)}${String(v.inSpec).padStart(9)}${String(v.exercised).padStart(11)}${String(v.responseSchema).padStart(13)}${String(v.requestSchema).padStart(12)}${String(v.failing).padStart(9)}`);
  if (missing.length) {
    console.log('\nNot in openapi.yaml:');
    for (const e of missing) console.log(`  ${e.method} ${e.template} — ${e.specGap ? 'spec gap (in Go router)' : e.allowlisted ? `missing in backend: ${e.allowlisted}` : 'missing in backend'}`);
  }
  const gaps = [...new Map(issues.filter((i) => i.kind === 'spec-gap' || i.kind === 'live-transport').map((i) => [`${i.endpoint} ${i.message}`, i])).values()];
  if (gaps.length) {
    console.log(`\nSpec gaps / live blockers (${gaps.length}, warnings):`);
    for (const g of gaps) console.log(`  ${g.endpoint}: ${g.message}`);
  }
  if (unexercised.length) {
    console.log(`\nNot exercised (${unexercised.length}):`);
    for (const u of unexercised) console.log(`  ${u}`);
  }
  const printed = [...dedup.values()].filter((i) => verbose || i.severity === 'error');
  if (printed.length) {
    console.log(`\nIssues (${errors.length} errors, ${warns.length} warnings${verbose ? '' : '; --verbose for warnings'}):`);
    for (const i of printed) console.log(`  [${i.severity}] ${i.kind} ${i.endpoint} ×${i.count} (${i.suite}${i.tag ? `:${i.tag}` : ''}): ${i.message}`);
  } else console.log(`\n0 contract errors (${warns.length} warnings; --verbose to list)`);

  return {
    ok: errors.length === 0,
    report: {
      exchanges: records.length,
      endpoints: total,
      exercised,
      areas,
      unexercised,
      issues: [...dedup.values()],
      endpointsDetail: appEps.map((e) => ({ ...e, statuses: [...e.statuses].sort() })),
    },
  };
}
