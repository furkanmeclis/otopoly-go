/**
 * Self-test for the SSE contract (sse.mjs): a stream with known mistakes must be rejected, a correct
 * Go-shaped stream must pass. Run by run.mjs before validating the recorded traffic.
 */
import { buildSseContract, validateSse } from './sse.mjs';

const U = '6f1c2a5e-0b8e-4d7a-9a51-2b7e0c1d3f40';

export function sseSelfTest(spec, ajv) {
  const ops = buildSseContract(spec);
  const compile = (_name, schema) => ajv.compile(schema);
  const failures = [];
  const msg = ops.get('POST /v1/tenant/ai/conversations/{uuid}/messages');
  const confirm = ops.get('POST /v1/tenant/ai/actions/{uuid}/confirm');
  if (!msg || !confirm) return ['spec has no SSE description for the AI messages / confirm endpoints'];
  for (const ev of ['message_start', 'text_delta', 'tool_start', 'tool_result', 'chart', 'plan', 'confirm', 'error', 'message_done', 'title'])
    if (!msg.events.has(ev)) failures.push(`messages: event "${ev}" not parsed from the spec`);
  if (!confirm.events.has('action') || !confirm.events.get('message_start')?.properties.resumed) failures.push('confirm: action / resumed message_start not parsed');

  const base = { accept: 'text/event-stream', streamComplete: true };
  const good = validateSse(
    {
      ...base,
      events: [
        { event: 'message_start', data: { conversation_uuid: U, user_message_uuid: U } },
        { event: 'tool_start', data: { id: 'toolu_1', name: 'list_jobs' } },
        { event: 'tool_result', data: { id: 'toolu_1', name: 'list_jobs', ok: true, summary_key: '', summary_params: null } },
        { event: 'text_delta', data: { text: 'Merhaba ' } },
        { event: 'error', data: { code: 'max_tokens', message: 'cut' } },
        { event: 'message_done', data: { message_uuid: U, status: 'complete', stop_reason: 'end_turn', usage: { input_tokens: 1 } } },
        { event: 'title', data: { conversation_uuid: U, title: 'T' } },
      ],
    },
    msg,
    compile,
  );
  if (good.length) failures.push(`valid stream rejected: ${good.join(' | ')}`);

  const bad = validateSse(
    {
      accept: 'application/json',
      streamComplete: true,
      events: [
        { event: 'text_delta', data: { text: 1, extra: true } },
        { event: 'error', data: { code: 'bogus', message: 'm' } },
        { event: 'title', data: { conversation_uuid: U, title: 't' } },
        { event: 'message_done', data: { message_uuid: U, status: 'weird', stop_reason: 'end_turn', usage: {} } },
        { event: 'chart', data: { id: 'a', chart: { type: 'bar' } } },
        { event: 'nope', data: {} },
      ],
    },
    msg,
    compile,
  );
  const expect = ['Accept', '"text_delta"', '"error"', '"message_done"', '"chart"', '"nope"', 'first event', 'after message_done', 'title must come after'];
  for (const e of expect) if (!bad.some((p) => p.includes(e))) failures.push(`invalid stream not flagged for: ${e}`);

  const badConfirm = validateSse({ ...base, events: [{ event: 'message_start', data: { conversation_uuid: U, resumed: true, action_uuid: U } }] }, confirm, compile);
  if (!badConfirm.some((p) => p.includes('"action"'))) failures.push('confirm stream without action not flagged');
  return failures;
}
