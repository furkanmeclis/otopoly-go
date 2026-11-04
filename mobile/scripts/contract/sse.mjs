/**
 * Server-sent event contract for `text/event-stream` operations (AI chat, AI action confirm).
 *
 * openapi.yaml documents the events only in the operation description, one per bullet:
 *   - `message_start` `{conversation_uuid, user_message_uuid}`
 *   - `chart` `{id, chart: AIChart}`
 *   - `error` `{code, message}` (provider_error, quota_exceeded, …)
 *   - `action` `{action_uuid, status, tool_use_id, block: AIUIBlock}` (confirmed | failed)
 * This module turns those bullets into JSON Schemas (exact keys, `Type` → component `$ref`, `key: true` →
 * const, a trailing `(a | b)` / `(a, b, …)` list → enum of `code`/`status`), so a spec change to an event
 * shape fails the contract test. Field types the bullets leave implicit follow the Go emitters
 * (`backend/internal/modules/ai/usecase/chat.go`, `actions.go`).
 */

const BULLET = /`(\w+)` `\{([^}]*)\}`(?:\s*\(([^)]*)\))?/g;
const ENUM_LIST = /^\s*[a-z_]+(\s*[|,]\s*[a-z_]+)+\s*$/;

function implicitType(field, event) {
  if (/_uuid$/.test(field)) return { type: 'string', format: 'uuid' };
  if (field === 'ok' || field === 'resumed') return { type: 'boolean' };
  if (field === 'usage') return { type: 'object' };
  // Go `map[string]any` left nil by tools without a summary is marshalled as null.
  if (field === 'summary_params') return { type: ['object', 'null'] };
  if (field === 'status' && event === 'message_done') return { $ref: 'openapi.json#/components/schemas/AIMessage/properties/status' };
  return { type: 'string' };
}

/** `{a, b: Type, c: true}` → JSON Schema with exactly those keys. */
function eventSchema(event, fields, trailing) {
  const properties = {};
  const required = [];
  for (const raw of fields.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, type] = raw.split(':').map((s) => s.trim());
    required.push(name);
    if (type === 'true' || type === 'false') properties[name] = { const: type === 'true' };
    else if (type && /^[A-Z]\w+$/.test(type)) properties[name] = { $ref: `openapi.json#/components/schemas/${type}` };
    else properties[name] = implicitType(name, event);
  }
  if (trailing && ENUM_LIST.test(trailing)) {
    const values = trailing.split(/[|,]/).map((s) => s.trim());
    const key = 'code' in properties ? 'code' : 'status' in properties ? 'status' : null;
    if (key) properties[key] = { type: 'string', enum: values };
  }
  return { type: 'object', required, properties, additionalProperties: false };
}

function parseBullets(description = '') {
  const events = new Map();
  for (const m of description.matchAll(BULLET)) events.set(m[1], eventSchema(m[1], m[2], m[3]));
  return events;
}

/**
 * Event schemas per streaming operation. The confirm endpoint streams `action`, then "the same events as
 * the messages endpoint" with its own `message_start` (resumed) shape.
 */
export function buildSseContract(spec) {
  const ops = new Map();
  let messages = null;
  for (const [template, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const streams = Object.values(op?.responses ?? {}).some((r) => r?.content?.['text/event-stream']);
      if (!streams) continue;
      const events = parseBullets(op.description);
      const key = `${method.toUpperCase()} ${template}`;
      ops.set(key, { events, resumes: events.has('action') });
      if (!events.has('action')) messages = events;
    }
  }
  for (const entry of ops.values()) if (entry.resumes && messages) entry.events = new Map([...messages, ...entry.events]);
  return ops;
}

/**
 * Validates one recorded stream: content type documented, `Accept: text/event-stream` sent, every event
 * documented and shaped as documented, and the event order the Go handlers produce.
 */
export function validateSse(rec, contract, compile) {
  const problems = [];
  const events = rec.events ?? [];
  if (rec.accept !== 'text/event-stream') problems.push(`request must send Accept: text/event-stream (sent ${rec.accept ?? 'none'})`);
  if (!rec.streamComplete && !rec.aborted) problems.push('stream was not read to the end');
  for (const [i, ev] of events.entries()) {
    const schema = contract.events.get(ev.event);
    if (!schema) {
      problems.push(`event #${i} "${ev.event}" is not documented (spec: ${[...contract.events.keys()].join(', ')})`);
      continue;
    }
    if (ev.data === undefined) {
      problems.push(`event #${i} "${ev.event}": data is not JSON (${String(ev.raw).slice(0, 60)})`);
      continue;
    }
    const fn = compile(ev.event, schema);
    if (!fn(ev.data)) problems.push(`event #${i} "${ev.event}": ${(fn.errors ?? []).slice(0, 4).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`).join('; ')}`);
  }

  // Order (usecase RunTurn / RunConfirm): start → content… → message_done → title.
  const names = events.map((e) => e.event);
  const done = names.indexOf('message_done');
  if (names.filter((n) => n === 'message_done').length > 1) problems.push('more than one message_done');
  if (contract.resumes) {
    if (names[0] !== 'action') problems.push(`first event must be "action" (got ${names[0] ?? 'none'})`);
    if (names.length > 1) {
      if (names[1] !== 'message_start' || events[1].data?.resumed !== true) problems.push('after "action" the continuation must open with message_start {resumed: true}');
      if (done === -1 && !rec.aborted) problems.push('continuation never sent message_done');
    }
  } else {
    if (names[0] !== 'message_start' && !(rec.aborted && !names.length)) problems.push(`first event must be "message_start" (got ${names[0] ?? 'none'})`);
    else if (events[0]?.data?.resumed) problems.push('a new message must not be "resumed"');
    if (done === -1 && !names.includes('error') && !rec.aborted) problems.push('no message_done and no error event');
  }
  if (done !== -1) {
    const after = names.slice(done + 1).filter((n) => n !== 'title');
    if (after.length) problems.push(`events after message_done: ${after.join(', ')}`);
  }
  const titleAt = names.indexOf('title');
  if (titleAt !== -1 && titleAt < done) problems.push('title must come after message_done');
  return problems;
}
